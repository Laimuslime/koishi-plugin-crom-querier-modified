import { Context, Schema, h } from "koishi";
import { queries } from "./api/graphql";
import { BACKEND_URL, BROWSER_HEADERS, GRAPHQL_ENDPOINTS, checkProxyStatus } from "./api/client";
import { 
  getBlacklist, getAdmins, getReportChannel, setReportChannel, botBan, memberAdminRequest, 
  qqVerify, qqUnbind, bindQuery, pageHistory, userRank, rawGraphql 
} from "./api/index";
import { WikiInfo, wikitApiRequest } from "./lib";

import type { Argv, Session } from "koishi";
import type { Article, AuthorRank, TitleQueryResponse, UserQueryResponse, UserRankQueryResponse } from "./types";

declare module "koishi" {
  interface Tables {
    wikitQuerier: WikitQuerierTable;
  }
}

interface WikitQuerierTable {
  id?: number;
  platform: string;
  channelId: string;
  defaultWiki: string;
}

export const name: string = "wikit-querier";

export const inject: string[] = ["database"];

const authorPageTagsConfig: Record<string, string[]> = {
  "if-backrooms": ["作者", "原创", "author:"],
  "scp-wiki-cloud": ["作者页", "author", "作者", "fragment:"],
  "backroom-wiki-cn": ["人事档案", "author", "作者"],
  "rpc-wiki-cn": ["作者页", "作者"]
};

export interface Config {
  bannedUsers: string[];
  bannedTitles: string[];
  bannedTags: string[];
  apiToken: string;
  wikitToken: string;
  wikidotUsername?: string;
  wikidotPassword?: string;
  defaultReportChannels: string[];
}

export const Config: Schema<Config> = Schema.object({
  bannedUsers: Schema.array(Schema.string()).description("禁止查询的用户列表"),
  bannedTitles: Schema.array(Schema.string()).description("禁止查询的文章列表"),
  bannedTags: Schema.array(Schema.string()).description("禁止查询的标签列表"),
  apiToken: Schema.string().default("wikit_secure_token_123").description("与独立后台通信的验证 Token"),
  wikitToken: Schema.string().required().description("Wikit官方网站绑定与解绑通信 Token (必填)"),
  wikidotUsername: Schema.string().description("用于执行分站站务的 Wikidot 账号"),
  wikidotPassword: Schema.string().role("secret").description("用于执行分站站务的 Wikidot 密码"),
  defaultReportChannels: Schema.array(Schema.string()).default([]).description("默认封禁通报的QQ群号列表（执行拉黑指令时可使用参数临时覆盖或取消）"),
}).description("查询与独立后台配置");

export function apply(ctx: Context, config: Config): void {
  ctx.model.extend("wikitQuerier", {
    id: "unsigned",
    platform: "string(64)",
    channelId: "string(64)",
    defaultWiki: "string(64)",
  }, {
    primary: 'id',
    autoInc: true,
    unique: [['platform', 'channelId']] 
  });

  const normalizeUrl = (url: string): string =>
    url
      .replace(/^https?:\/\/backrooms-wiki-cn.wikidot.com/, "https://brcn.backroomswiki.cn")
      .replace(/^https?:\/\/scp-wiki-cn.wikidot.com/, "https://scpcn.backroomswiki.cn")
      .replace(/^https?:\/\/([a-z]+-wiki-cn|nationarea)/, "https://$1");
  
  const getDefaultWiki = async (session: Session): Promise<string | undefined> => {
    const platform = session.event.platform;
    const channelId = session.event.channel.id;
    const data = await ctx.database.get("wikitQuerier", { platform, channelId });
    return data.length > 0 ? data[0].defaultWiki : undefined;
  };

  const sendReport = async (session: Session, notifyOpt: any, actionDesc: string) => {
    let targetChannels = config.defaultReportChannels || [];
    if (notifyOpt) {
      targetChannels = String(notifyOpt).split(",").map(c => c.trim()).filter(c => c);
    }
    if (targetChannels.length === 0) return "\n(通报未触发：后台未配置默认群，也未提供 -n 参数)";

    let successCount = 0;
    let failMsgs = [];
    for (const channel of targetChannels) {
      try {
        await session.bot.sendMessage(channel, actionDesc);
        successCount++;
      } catch (e: any) {
        failMsgs.push(`${channel}(报错: ${e.message || "未知错误"})`);
      }
    }
    let resultStr = `\n(尝试向 ${targetChannels.length} 个群通报：成功 ${successCount} 个`;
    if (failMsgs.length > 0) resultStr += `，失败: ${failMsgs.join(", ")}`;
    resultStr += `)`;
    return resultStr;
  };

  const fuzzyCache = new Map<string, { data: any[], expiresAt: number }>();
  const CACHE_TTL = 1000 * 60 * 60;

  let cmd = ctx.command('wikit', 'Wikit 综合查询与管理工具');

  cmd.subcommand("wikit-diag", "网络连通性诊断测试")
    .action(async ({ session }): Promise<string> => {
      let msg = "【Wikit 综合网络诊断报告】\n";
      msg += `操作人QQ: ${session.userId}\n\n`;

      const testUrl = async (label: string, url: string, fetchOptions: any) => {
        msg += `${label}\n`;
        try {
          const start = Date.now();
          const res = await fetch(url, { ...fetchOptions, signal: AbortSignal.timeout(8000) });
          msg += `耗时: ${Date.now() - start}ms\n`;
          msg += `状态码: ${res.status} ${res.statusText}\n`;
          let text = await res.text();
          text = text.substring(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, " ");
          msg += `返回截取: ${text}\n`;
        } catch (e: any) {
          msg += `异常: ${e.name}\n详情: ${e.message}\n根因: ${e.cause ? (e.cause.message || e.cause.code || JSON.stringify(e.cause)) : '无'}\n`;
        }
        msg += "\n";
      };

      await testUrl("1. Wikit 独立后台 API", `${BACKEND_URL}/api/admins`, { headers: BROWSER_HEADERS });
      
      try {
         const start = Date.now();
         await rawGraphql(queries.userGlobalQuery, { query: "calf-0" });
         msg += `2. Wikit GraphQL 接口 (${GRAPHQL_ENDPOINTS[0]})\n耗时: ${Date.now() - start}ms\n状态码: 200 OK\n\n`;
      } catch (e: any) {
         msg += `2. Wikit GraphQL 接口\n异常: ${e.message}\n\n`;
      }
      
      await testUrl("3. Wikit 官方网站主页", "https://wikit.unitreaty.org/", { headers: BROWSER_HEADERS });
      await testUrl("4. Wikidot 网站连通性", "https://www.wikidot.com/", { headers: BROWSER_HEADERS });

      return msg.trim();
    });
  
  cmd
    .subcommand("wikit-list", "列出所有支持的网站。")
    .action(async (): Promise<string> => {
      const entries = Object.entries(WikiInfo);
      const lines = entries.map(([key, value]) => `站点名称：${value.wiki}\n简写：${key}`);
      return `支持的维基列表：\n${lines.join("\n")}`;
    });

  cmd
    .subcommand("wikit-default-wiki <维基名称:string>", "设置默认维基。")
    .alias("wikit-db")
    .action(async (argv: Argv, wiki: string): Promise<string> => {
      const platform = argv.session.event.platform;
      const channelId = argv.session.event.channel.id;
      if (!wiki || !Object.keys(WikiInfo).includes(wiki) || wiki === "all") {
        return "维基名称不正确。";
      }
      ctx.database.upsert("wikitQuerier", [{ channelId, platform, defaultWiki: wiki }], ["platform", "channelId"]);
      return `已将本群默认查询维基设置为: ${wiki}`;
    });

  cmd
    .subcommand("wikit-notification [targetChannelId:string]", "指定本群黑名单绑定时的上报群聊 (仅限管理员)")
    .alias("wikit-nf")
    .action(async ({ session }, targetChannelId): Promise<string> => {
      if (!checkProxyStatus(BACKEND_URL + "/api/admins")) return "API请求失败，请稍后重试";

      const adminList = await getAdmins();
      const userId = String(session.userId);
      if (!adminList.includes(userId)) return "权限不足，你无法使用此指令。";
      if (!targetChannelId) return "参数缺失。用法：wikit-notification QQ群号 (输入 0 即可取消本群上报)";

      const source = session.channelId;
      const target = targetChannelId === "0" ? "" : targetChannelId;

      try {
        const data = await setReportChannel(config.apiToken, source, target);
        if (data.success) {
          return target ? `设置成功！本群的封禁账号绑定记录将上报至群聊：${target}` : "已取消本群的上报功能。";
        } else {
          return `设置失败：${data.error}`;
        }
      } catch (e: any) {
        return `请求独立后台失败：${e.message}`;
      }
    });

  cmd
    .subcommand("wikit-ban <type:string> <id:string> [wiki:string]", "拉黑指定的 QQ/WD 账号或进行分站站务操作 (仅限管理员)")
    .option("notify", "-n <channels:string> 临时指定通报的群号")
    .option("silent", "-s 静默拉黑，不发送任何通报")
    .option("remove", "-r 执行移除操作 (默认是封禁)")
    .action(async ({ session, options }, type, id, wiki): Promise<string> => {
      if (!checkProxyStatus(BACKEND_URL + "/api/admins")) return "API请求失败，请稍后重试";

      const adminList = await getAdmins();
      const userId = String(session.userId);
      if (!adminList.includes(userId)) return "权限不足，你无法使用拉黑指令。";
      if (!type || !id) return "参数缺失。用法：wikit-ban qq 12345678 或 wikit-ban wd username 或 wikit-ban site username wiki [-r]";

      const opts: any = options || {};

      if (type === "-site" || type === "site") {
        if (!wiki) return "缺少分站参数。用法：wikit-ban site 用户名 分站名 (加 -r 参数为移除)";
        if (!config.wikidotUsername || !config.wikidotPassword) return "未配置分站管理账号。请先在 Koishi 插件配置页中填写 Wikidot 账号和密码。";

        const validWikis = ["all", ...Object.keys(WikiInfo)];
        if (!validWikis.includes(wiki.toLowerCase())) return `检测不到名为“${wiki}”的维基，请检查拼写是否正确。`;

        const wikiName = WikiInfo[wiki.toLowerCase()]?.wiki || wiki.toLowerCase();
        const actionType = opts.remove ? "remove" : "ban";
        
        let finalMsg = "";
        let finalIsSuccess = false;
        let actionTextForNotify = "";

        if (actionType === "ban") {
           const removeResult = await memberAdminRequest({
             token: config.wikitToken, wiki: wikiName, username: config.wikidotUsername, password: config.wikidotPassword, member: id, action: "remove"
           });
           
           const lowerErr = removeResult.errorMessage.toLowerCase();
           const ignoreRemoveFail = lowerErr.includes("not a member") || 
                                    lowerErr.includes("不是成员") || 
                                    lowerErr.includes("user_not_member") || 
                                    lowerErr.includes("not_member");

           if (!removeResult.isSuccess && !ignoreRemoveFail) {
               return `分站封禁前置拦截（移除失败）：${removeResult.errorMessage}`;
           }

           const banResult = await memberAdminRequest({
             token: config.wikitToken, wiki: wikiName, username: config.wikidotUsername, password: config.wikidotPassword, member: id, action: "ban", reason: "由Wikit机器人远程封禁"
           });

           if (banResult.isSuccess) {
              finalIsSuccess = true;
              actionTextForNotify = "封禁";
              finalMsg = `分站封禁成功：已在 ${wikiName} 移除并封禁用户 ${id}。`;
           } else {
              return `分站封禁执行失败：${banResult.errorMessage}`;
           }
        } else {
           const removeResult = await memberAdminRequest({
             token: config.wikitToken, wiki: wikiName, username: config.wikidotUsername, password: config.wikidotPassword, member: id, action: "remove"
           });
           
           if (removeResult.isSuccess) {
              finalIsSuccess = true;
              actionTextForNotify = "移除";
              finalMsg = `分站移除成功：已在 ${wikiName} 移除用户 ${id}。`;
           } else {
              return `分站移除失败：${removeResult.errorMessage}`;
           }
        }

        if (finalIsSuccess) {
            if (!opts.silent) {
              const reportDesc = `【Wikit 站务通报】\n管理员执行了分站${actionTextForNotify}操作\n操作人：${userId}\n操作分站：${wikiName}\n操作目标：${id}\n动作：${actionTextForNotify.toUpperCase()}`;
              finalMsg += await sendReport(session, opts.notify, reportDesc);
            }
            return finalMsg;
        }
      }

      if (type !== "qq" && type !== "wd") return "类型错误。第一个参数只能是 qq、wd 或 site。";
      const targetType = type === "qq" ? "qqs" : "wikidots";

      try {
        const data = await botBan(config.apiToken, targetType, id);
        if (data.success) {
          let msg = `拉黑成功：已将 ${id} 加入 ${targetType} 黑名单。`;
          if (!opts.silent) {
              const reportDesc = `【Wikit 封禁通报】\n管理员执行了拉黑操作\n操作人：${userId}\n封禁类型：${type === "qq" ? "QQ号" : "Wikidot账号"}\n封禁目标：${id}`;
              msg += await sendReport(session, opts.notify, reportDesc);
          }
          return msg;
        } else {
          return `拉黑失败：${data.error}`;
        }
      } catch (e: any) {
        return `请求独立后台失败：${e.message}。请检查后台地址或Token。`;
      }
    });

  cmd
    .subcommand("wikit-banlist", "查看黑名单一览 (仅限管理员)")
    .alias("wikit-bl")
    .action(async ({ session }): Promise<string> => {
      if (!checkProxyStatus(BACKEND_URL + "/api/admins")) return "API请求失败，请稍后重试";

      const adminList = await getAdmins();
      const userId = String(session.userId);
      if (!adminList.includes(userId)) return "权限不足，你无法使用查看黑名单指令。如果确认配置没问题，请使用 wikit-diag 检查网络。";

      try {
        const blacklist = await getBlacklist();
        const qqs = blacklist.qqs || [];
        const wds = blacklist.wikidots || [];
        let result = "全站云端黑名单一览：\n";
        result += `QQ黑名单 (${qqs.length}个)：\n${qqs.length > 0 ? qqs.join(", ") : "暂无"}\n\n`;
        result += `Wikidot账号黑名单 (${wds.length}个)：\n${wds.length > 0 ? wds.join(", ") : "暂无"}`;
        return result;
      } catch (e: any) {
        return `获取黑名单失败：${e.message}`;
      }
    });

  cmd
    .subcommand("wikit-verify", "获取维基绑定链接")
    .alias("wikit-v")
    .action(async ({ session }): Promise<string> => {
      if (!checkProxyStatus(GRAPHQL_ENDPOINTS[0])) return `<quote id="${session.messageId}" /> API请求失败，请稍后重试`;

      const qq = session.userId;
      const messageId = session.messageId;
      const channelId = session.channelId;

      try {
        const data = await qqVerify(qq, config.wikitToken);
        if (data.status === "error" && data.rawText) {
            return `<quote id="${messageId}" /><at id="${qq}" /> 服务器异常返回：\n${data.rawText}`; 
        }

        if (data.status === "success") {
          const checkIntervals = [10000, 10000, 15000, 15000, 20000, 20000, 30000, 30000, 30000, 40000, 40000, 40000];

          const pollCheck = (index: number) => {
            if (index >= checkIntervals.length) {
              session.bot.sendMessage(channelId, `<quote id="${messageId}" /><at id="${qq}" /> 绑定超时！你未能在5分钟内完成维基账号绑定，请重新输入指令获取新的链接。`).catch(() => {});
              return; 
            }

            ctx.setTimeout(async () => {
              try {
                const queryData = await bindQuery("qq", qq);
                const userInfo = queryData[qq] || queryData.data || queryData;

                if (userInfo && userInfo.id) {
                  const currentBlacklist = await getBlacklist();
                  const isBlacklisted = (currentBlacklist.wikidots && currentBlacklist.wikidots.includes(userInfo.id)) || (currentBlacklist.qqs && currentBlacklist.qqs.includes(qq));
                  
                  if (isBlacklisted) {
                    await session.bot.sendMessage(channelId, `<quote id="${messageId}" /><at id="${qq}" /> 绑定成功，但由于该信息已被列入黑名单，你仍无法使用各项查询功能。`);
                    const reportChannel = await getReportChannel(channelId);
                    if (reportChannel) {
                      try { await session.bot.sendMessage(reportChannel, `【Wikit 封禁拦截通知】\n发现被封禁的用户进行了绑定！\nQQ号：${qq}\n维基ID：${userInfo.id}\n操作群聊：${channelId}`); } catch (err) {}
                    }
                  } else {
                    await session.bot.sendMessage(channelId, `<quote id="${messageId}" /><at id="${qq}" /> 绑定成功！已为你绑定维基ID：${userInfo.id}`);
                  }
                  return;
                } else {
                  pollCheck(index + 1);
                }
              } catch (err) {
                pollCheck(index + 1);
              }
            }, checkIntervals[index]);
          };

          pollCheck(0);
          return `<quote id="${messageId}" /><at id="${qq}" /> 验证请求成功！\n你的QQ：${qq}\n请点击以下链接完成绑定：\n${data["verification-link"]}`;
        }
        return `<quote id="${messageId}" /><at id="${qq}" /> 验证失败：${data.message || data.rawText}`;
      } catch (err: any) { 
        return `<quote id="${messageId}" /><at id="${qq}" /> 请求出错：${err.message}`; 
      }
    });

  cmd
    .subcommand("wikit-unbind", "解除维基账号绑定")
    .alias("wikit-ub")
    .action(async ({ session }): Promise<string> => {
      if (!checkProxyStatus(GRAPHQL_ENDPOINTS[0])) return `<quote id="${session.messageId}" /> API请求失败，请稍后重试`;

      const qq = session.userId;
      const messageId = session.messageId;

      const blacklist = await getBlacklist();
      if (blacklist.qqs && blacklist.qqs.includes(qq)) {
        return `<quote id="${messageId}" /><at id="${qq}" /> 你的QQ号已被列入黑名单，无法使用解绑功能。`;
      }

      try {
        const bindData = await bindQuery("qq", qq);
        if (bindData.status === "success" && bindData.data) {
          let userInfo = bindData.data;
          if (Array.isArray(userInfo)) userInfo = userInfo[0];
          else if (typeof userInfo === "object" && !userInfo.qq) {
            const keys = Object.keys(userInfo);
            if (keys.length > 0) userInfo = userInfo[keys[0]];
          }
          if (userInfo && userInfo.id && blacklist.wikidots && blacklist.wikidots.includes(userInfo.id)) {
            return `<quote id="${messageId}" /><at id="${qq}" /> 你的维基账号 (${userInfo.id}) 已被列入黑名单，无法使用解绑功能。`;
          }
        }
      } catch (e) {}

      try {
        const data = await qqUnbind(qq, config.wikitToken);
        if (data.status === "success") {
          return `<quote id="${messageId}" /><at id="${qq}" /> 解绑成功！\n你的QQ：${qq}\n已解除与维基账号的绑定。`;
        } else {
          return `<quote id="${messageId}" /><at id="${qq}" /> 解绑失败！\n返回信息：${data.message || data.rawText}`;
        }
      } catch (err: any) { 
        return `<quote id="${messageId}" /><at id="${qq}" /> 请求出错：${err.message}`; 
      }
    });

  cmd
    .subcommand("wikit-info", "查看维基绑定信息")
    .alias("wikit-i")
    .option("qq", "-q <qq:string> 通过QQ号查询")
    .option("wd", "-w <wd:string> 通过Wikidot账号查询")
    .option("all", "-a 查询所有绑定记录")
    .action(async ({ session, options }): Promise<any> => {
      if (!checkProxyStatus(GRAPHQL_ENDPOINTS[0])) return <template><quote id={session.messageId} />API请求失败，请稍后重试</template>;

      const senderId = session.userId;
      const messageId = session.messageId;
      const opts = options as any;
      const blacklist = await getBlacklist();

      if (opts?.all) {
        const adminList = await getAdmins();
        const userId = String(session.userId);
        if (!adminList.includes(userId)) return <template><quote id={messageId} />权限不足，无法查询全站记录。</template>;

        try {
          const resData = await bindQuery("all");
          if (resData.status === "error" && resData.rawText) return <template><quote id={messageId} />服务器返回异常：<br />{resData.rawText}</template>;

          if (resData.status === "success" && resData.data && Array.isArray(resData.data)) {
            const list = resData.data;
            if (list.length === 0) return <template><quote id={messageId} />当前没有任何绑定记录。</template>;

            const contentNode = (
              <template>
                全站绑定记录一览（共 {resData.count || list.length} 条）：<br />
                {list.map((item: any) => {
                  const bindTime = new Date(item.bind_time * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
                  return <template>QQ: {item.qq} | ID: {item.id} | 时间: {bindTime}<br /></template>;
                })}
              </template>
            );

            if (list.length > 20) return <message forward><message>{contentNode}</message></message>;
            return <template><quote id={messageId} />{contentNode}</template>;
          }
          return <template><quote id={messageId} />查询全部记录失败，未获取有效数据。</template>;
        } catch (err: any) {
          return <template><quote id={messageId} />请求出错：{err.message}</template>;
        }
      }

      let queryType: "id" | "qq" = "qq";
      let queryValue = "";
      let typeLabel = "";

      if (opts?.wd) {
        queryType = "id";
        queryValue = opts.wd;
        typeLabel = "Wikidot账号";
        if (blacklist.wikidots && blacklist.wikidots.includes(queryValue)) return <template><quote id={messageId} />该Wikidot账号已被列入黑名单，无法查询绑定信息。</template>;
      } else {
        queryType = "qq";
        queryValue = opts?.qq || senderId;
        typeLabel = "QQ号";
        if (blacklist.qqs && blacklist.qqs.includes(queryValue)) return <template><quote id={messageId} />该QQ号已被列入黑名单，无法查询绑定信息。</template>;
      }

      try {
        const resData = await bindQuery(queryType, queryValue);
        if (resData.status === "error" && resData.rawText) return <template><quote id={messageId} />查询失败，服务器返回异常：<br />{resData.rawText}</template>;

        if (resData.status === "success" && resData.data) {
          let info = resData.data;
          if (Array.isArray(info)) info = info[0];
          else if (typeof info === "object" && info !== null && !info.qq) {
            const keys = Object.keys(info);
            if (keys.length > 0) info = info[keys[0]];
          }

          if (!info || (!info.qq && !info.id)) return <template><quote id={messageId} />未查询到该 {typeLabel} ({queryValue}) 的绑定记录。</template>;
          if ((blacklist.wikidots && blacklist.wikidots.includes(info.id)) || (blacklist.qqs && blacklist.qqs.includes(info.qq))) {
            return <template><quote id={messageId} />该绑定信息已被列入黑名单，查询请求被拒绝。</template>;
          }

          const bindTime = new Date(info.bind_time * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
          return <template><quote id={messageId} />查询成功！<br />QQ号：{info.qq}<br />维基ID：{info.id}<br />绑定时间：{bindTime}</template>;
        } else {
          return <template><quote id={messageId} />未查询到该 {typeLabel} ({queryValue}) 的绑定记录。</template>;
        }
      } catch (err: any) {
        return <template><quote id={messageId} />请求出错：{err.message}</template>;
      }
    });

  cmd
    .subcommand("wikit-author <作者:string> [维基名称:string]", "查询作者及作者页。")
    .alias("wikit-au")
    .option("fuzzy", "-m 开启模糊搜索")
    .action(async (argv: Argv, author: string, wiki: string | undefined): Promise<any> => {
      if (!checkProxyStatus(GRAPHQL_ENDPOINTS[0])) return <template>API请求失败，请稍后重试</template>;

      if (!author) return <template>请提供作者名。</template>;

      const validwikies = ["all", ...Object.keys(WikiInfo)];
      if (wiki && !validwikies.includes(wiki.toLowerCase())) return <template>查询失败：检测不到名为“{wiki}”的维基，请检查拼写是否正确。</template>;

      let finalWiki = wiki ? wiki.toLowerCase() : ((await getDefaultWiki(argv.session)) || "all");
      let authorName = author;

      const isRankQuery = /^#[0-9]{1,15}$/.test(authorName);
      const rankNumber = isRankQuery ? Number(authorName.slice(1)) : null;
      let queryString = isRankQuery ? queries.userRankQuery : queries.userQuery;

      if (!isRankQuery) authorName = authorName.replace(/["'“”‘’]/g, "").trim();

      try {
        if (finalWiki === "all") queryString = isRankQuery ? queries.userRankQuery : queries.userGlobalQuery;

        const options: any = argv.options || {}; 

        if (options.fuzzy && !isRankQuery) {
          const cacheKey = finalWiki;
          let allAuthors: any[] = [];
          const now = Date.now();

          if (fuzzyCache.has(cacheKey) && fuzzyCache.get(cacheKey)!.expiresAt > now) {
            allAuthors = fuzzyCache.get(cacheKey)!.data;
          } else {
            const wikiName = finalWiki === "all" ? undefined : (WikiInfo[finalWiki]?.wiki || finalWiki);
            const fuzzyQueryStr = wikiName 
               ? `query { authorRanking(wiki: "${wikiName}", by: RATING) { name } }`
               : `query { authorRanking(by: RATING) { name } }`;

            const fuzzyData = await rawGraphql(fuzzyQueryStr);
            allAuthors = fuzzyData?.data?.authorRanking || [];
            if (allAuthors.length > 0) fuzzyCache.set(cacheKey, { data: allAuthors, expiresAt: now + CACHE_TTL });
          }

          const localBannedUsers = config.bannedUsers || [];
          const matches = allAuthors
            .filter((a: any) => a.name.toLowerCase().includes(authorName.toLowerCase()))
            .map((a: any) => a.name)
            .filter((n: string) => !localBannedUsers.includes(n));

          if (matches.length > 0) authorName = matches[0]; 
          else return <template>未在排行榜中找到包含该关键词的作者。</template>;
        }

        let result = await wikitApiRequest(authorName, finalWiki, 0, queryString);
        const localBannedUsersCheck = config.bannedUsers || [];

        if (isRankQuery && (result as UserRankQueryResponse).authorRanking) {
          const rankData = result as UserRankQueryResponse;
          const matchedUser = rankData.authorRanking.find(u => u.rank === rankNumber && !localBannedUsersCheck.includes(u.name));
          if (matchedUser) {
            let secondQuery = (!finalWiki || finalWiki === "all") ? queries.userGlobalQuery : queries.userQuery;
            result = await wikitApiRequest(matchedUser.name, finalWiki, 0, secondQuery);
          }
        }

        let data = result as any;
        let user = (data.authorRanking?.find((u: any) => u.rank === rankNumber) || data.authorGlobalRank || data.authorWikiRank);

        if ((!user || localBannedUsersCheck.includes(user.name)) && !isRankQuery && !options.fuzzy) {
          const unixName = authorName.toLowerCase().replace(/\s+/g, '-');
          if (unixName !== authorName) {
            result = await wikitApiRequest(unixName, finalWiki, 0, queryString);
            data = result as any;
            user = (data.authorRanking?.find((u: any) => u.rank === rankNumber) || data.authorGlobalRank || data.authorWikiRank);
          }
        }

        if (!user || localBannedUsersCheck.includes(user.name)) return <template>未找到该用户。</template>;
        
        const total = data.articles?.pageInfo?.total ?? 0;
        const average = total > 0 ? (user.value / total).toFixed(2) : 0;

        let recentNode: any = null;
        let recentArticle: any = null;

        if (data.recent && data.recent.nodes && data.recent.nodes.length > 0) {
          recentArticle = data.recent.nodes[0];
        } else if (total > 0) {
          try {
            const wikiFilter = finalWiki !== "all" ? `wiki: ["${WikiInfo[finalWiki]?.wiki || finalWiki}"], ` : "";
            const recentGql = `query { articles(${wikiFilter}author: "${user.name}", pageSize: 1) { nodes { title url created_at } } }`;
            const resData = await rawGraphql(recentGql);
            if (resData?.data?.articles?.nodes?.length > 0) recentArticle = resData.data.articles.nodes[0];
          } catch(e) {}
        }

        const localBannedTitles = config.bannedTitles || [];
        if (recentArticle && !localBannedTitles.includes(recentArticle.title)) {
          let dateStr = "";
          if (recentArticle.created_at) {
             const d = new Date(recentArticle.created_at);
             if (!isNaN(d.getTime())) dateStr = ` (${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')})`;
          }
          recentNode = <template><br />最近发布：{recentArticle.title}{dateStr}<br />{normalizeUrl(recentArticle.url)}</template>;
        }

        let authorPageNodes: any = null;
        try {
          const graphqlQuery = `query { articles(author: "${user.name}", page: 1, pageSize: 100) { nodes { title url wiki tags } } }`;
          const pageData = await rawGraphql(graphqlQuery);
          const nodes = pageData?.data?.articles?.nodes || [];
          
          let hubs = nodes.filter((n: any) => {
            if (!n.wiki) return false;
            const targetRules = authorPageTagsConfig[n.wiki] || ["author:"];
            const tagRules = targetRules.filter(r => !r.endsWith(':')).map(r => r.toLowerCase());
            const categoryRules = targetRules.filter(r => r.endsWith(':')).map(r => r.toLowerCase());
            const passTag = tagRules.length === 0 || (n.tags && n.tags.some((t: string) => tagRules.includes(t.toLowerCase())));
            const passCategory = categoryRules.length === 0 || (n.url && categoryRules.some(c => n.url.toLowerCase().includes('/' + c)));
            return passTag && passCategory;
          });
          
          if (finalWiki && finalWiki !== "all") {
             const wikiInfo = WikiInfo[finalWiki];
             if (wikiInfo) hubs = hubs.filter((n: any) => n.wiki === (wikiInfo.wiki || finalWiki));
          }

          if (hubs.length > 0) {
            if (finalWiki && finalWiki !== "all") {
              authorPageNodes = <template><br />作者页：{hubs.map((h: any, index: number) => <template>{normalizeUrl(h.url)}{index < hubs.length - 1 ? " | " : ""}</template>)}</template>;
            } else {
              authorPageNodes = <template><br />作者页：<br />{hubs.map((h: any) => <template>[{h.wiki}] {normalizeUrl(h.url)}<br /></template>)}</template>;
            }
          }
        } catch (e) {}

        return (
          <template>
            <quote id={argv.session.event.message.id} />
            {user.name} (#{user.rank})<br />总分：{user.value} 页面数：{total} 平均分：{average}
            {recentNode}
            {authorPageNodes}
          </template>
        );
      } catch (err: any) {
        return <template>查询失败: {err.message}</template>;
      }
    });

  cmd
    .subcommand("wikit-search <...args:string>", "查询文章。")
    .alias("wikit-sr")
    .option("tags", "-t <tags:string> 按标签过滤（多个标签用中英文逗号分隔，全包含）")
    .action(async (argv: Argv, ...args: string[]): Promise<any> => {
      if (!checkProxyStatus(GRAPHQL_ENDPOINTS[0])) return <template>API请求失败，请稍后重试</template>;

      if (!args || args.length === 0) return <template>请提供文章标题。</template>;

      const validWikies = ["all", ...Object.keys(WikiInfo)];
      const lastArg = args[args.length - 1].toLowerCase();
      let finalWiki = "all";
      let titleName = "";

      if (args.length > 1) {
        if (validWikies.includes(lastArg)) {
          finalWiki = lastArg;
          titleName = args.slice(0, -1).join(" ");
        } else {
          return <template>查询失败：检测不到名为“{lastArg}”的维基，请检查拼写是否正确。</template>;
        }
      } else {
        titleName = args[0];
        finalWiki = (await getDefaultWiki(argv.session)) || "all";
      }

      if (!titleName) return <template>请提供文章标题。</template>;
      const options: any = argv.options || {};

      try {
        let articles: any[] = [];
        if (options.tags) {
          const tagsArray = options.tags.split(/[,，]/).map((t: string) => t.trim()).filter((t: string) => t);
          const payload: any = {
            query: `query tagSearch($wiki: [String], $query: String, $tags: [String!]) {
              articles(wiki: $wiki, titleKeyword: $query, includeTags: $tags, page: 1, pageSize: 10) { nodes { title url author rating comments } }
            }`,
            variables: { query: titleName, tags: tagsArray }
          };
          if (finalWiki !== "all") payload.variables.wiki = [WikiInfo[finalWiki]?.wiki || finalWiki];
          
          const data = await rawGraphql(payload.query, payload.variables);
          articles = data?.data?.articles?.nodes || [];
        } else {
          const result = await wikitApiRequest(titleName, finalWiki, 0, queries.titleQuery);
          articles = (result as TitleQueryResponse)?.articles?.nodes || [];
        }

        if (!articles || articles.length === 0) return <template>未找到文章。</template>;

        const localBannedTitles = config.bannedTitles || [];
        const localBannedUsers = config.bannedUsers || [];
        const article = articles.find(a => !localBannedTitles.includes(a.title) && !localBannedUsers.includes(a.author));

        if (!article) return <template>未找到符合条件的文章。</template>;

        return (
          <template>
            <quote id={argv.session.event.message.id} />
            {article.title}<br />评分：{article.rating}<br />评论：{article.comments}<br />作者：{article.author || "已注销"}<br />{normalizeUrl(article.url)}
          </template>
        );
      } catch (err: any) {
        return <template>查询失败：{err.message}</template>;
      }
    });

  cmd
    .subcommand("wikit-history <urlOrName:string> [wiki:string]", "查询页面历史记录")
    .alias("wikit-h")
    .action(async (argv: Argv, urlOrName: string, wiki: string | undefined): Promise<any> => {
      if (!checkProxyStatus(GRAPHQL_ENDPOINTS[0])) return <template>API请求失败，请稍后重试</template>;

      if (!urlOrName) return <template>请提供页面完整链接或页面名称。</template>;

      let finalWiki = wiki;
      let finalUrl = urlOrName;

      if (urlOrName.startsWith("http")) {
        try {
          const urlObj = new URL(urlOrName);
          const hostParts = urlObj.hostname.split('.');
          if (!finalWiki && hostParts.length >= 3) finalWiki = hostParts[0];
        } catch(e) {}
      } else {
        finalWiki = finalWiki || (await getDefaultWiki(argv.session)) || "all";
        if (finalWiki === "all") return <template>请指定维基名称，或直接输入页面的完整网址。</template>;
        const wikiName = WikiInfo[finalWiki.toLowerCase()]?.wiki || finalWiki;
        finalUrl = `https://${wikiName}.wikidot.com/${urlOrName}`;
        finalWiki = wikiName;
      }

      const wikiName = finalWiki ? (WikiInfo[finalWiki.toLowerCase()]?.wiki || finalWiki) : "syndication";

      try {
        const data = await pageHistory(wikiName, finalUrl);
        if (data.status === "error") return <template>查询失败：{data.message || data.rawText || "未知错误"}</template>;

        const revKeys = Object.keys(data).filter(k => k.startsWith("rev:"));
        revKeys.sort((a, b) => parseInt(b.split(":")[1]) - parseInt(a.split(":")[1]));
        if (revKeys.length === 0) return <template>未查询到该页面的历史记录。</template>;

        const contributor = data.contributor?.username || "未知";
        const headerNode = (
          <template>
            页面：{finalUrl}<br />当前贡献者：{contributor}<br />共计 {revKeys.length} 条历史记录：
          </template>
        );

        const chunkSize = 20;
        const chunks = [];
        for (let i = 0; i < revKeys.length; i += chunkSize) chunks.push(revKeys.slice(i, i + chunkSize));

        return (
          <message forward>
            <message>{headerNode}</message>
            {chunks.map((chunk: string[]) => {
               const chunkLines = chunk.map(key => {
                  const rev = data[key];
                  const revNum = key.split(":")[1];
                  const ms = parseInt(rev.changeTime) * 1000;
                  const dateStr = new Date(ms + 8 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
                  
                  const cleanFlag = rev.flag ? String(rev.flag).replace(/\s+/g, "") : "";
                  const flagMap: Record<string, string> = {
                    "N": "新页面建立", "S": "源代码变更", "A": "标签/属性变更", "T": "标题变更",
                    "R": "页面重命名", "M": "页面移动", "F": "附件变更", "V": "版本回退"
                  };
                  const parsedFlags = cleanFlag.split('').map(c => flagMap[c] || c).join(" + ") || "无";
                  const comment = rev.comment ? `\n备注: ${rev.comment}` : "";
                  return `[版本 ${revNum}] (记录ID: ${rev.revRow})\n时间: ${dateStr}\n用户: ${rev.username}\n操作: ${parsedFlags}${comment}`;
               });
               return <message><template>{chunkLines.join("\n\n")}</template></message>;
            })}
          </message>
        );
      } catch (e: any) {
        return <template>请求历史记录出错：{e.message}</template>;
      }
    });

  cmd
    .subcommand("wikit-self", "查询作品与评分一览。")
    .alias("wikit-sf")
    .option("qq", "-q <qq:string> 通过QQ号查询")
    .option("wd", "-w <wd:string> 通过Wikidot账号查询")
    .action(async ({ session, options }): Promise<any> => {
      if (!checkProxyStatus(GRAPHQL_ENDPOINTS[0])) return <template><quote id={session.messageId} />API请求失败，请稍后重试</template>;

      const senderId = session.userId;
      const messageId = session.messageId;
      let wikidotId = "";
      const blacklist = await getBlacklist();

      if (options.wd) {
        wikidotId = options.wd;
        if (blacklist.wikidots && blacklist.wikidots.includes(wikidotId)) return <template><quote id={messageId} />该Wikidot账号已被列入黑名单，无法查询。</template>;
      } else {
        const targetQq = options.qq || senderId;
        if (blacklist.qqs && blacklist.qqs.includes(targetQq)) return <template><quote id={messageId} />该QQ号已被列入黑名单，无法查询。</template>;

        try {
          const bindData = await bindQuery("qq", targetQq);
          if (bindData.status !== "success" || !bindData.data) {
            const errorMsg = options.qq ? `未查询到QQ ${targetQq} 的绑定记录。` : "未查询到你的绑定记录，请先绑定账号。";
            return <template><quote id={messageId} />{errorMsg}</template>;
          }

          let infoList = Array.isArray(bindData.data) ? bindData.data : [bindData.data];
          if (infoList.length === 0 || !infoList[0] || !infoList[0].id) return <template><quote id={messageId} />未查询到有效的绑定记录。</template>;

          wikidotId = infoList[0].id;
          if ((blacklist.wikidots && blacklist.wikidots.includes(wikidotId)) || (blacklist.qqs && blacklist.qqs.includes(targetQq))) {
            return <template><quote id={messageId} />该绑定的 Wikidot 账号 ({wikidotId}) 已被列入黑名单，无法查询作品一览。</template>;
          }
        } catch (err: any) {
          return <template><quote id={messageId} />请求绑定接口出错：{err.message}</template>;
        }
      }

      const rankLines = await userRank(wikidotId);

      try {
        let allArticles: any[] = [];
        let currentPage = 1;
        let hasNextPage = true;
        const maxPages = 30;

        while (hasNextPage && currentPage <= maxPages) {
          const graphqlQuery = `query { articles(author: "${wikidotId}", page: ${currentPage}, pageSize: 100) { nodes { title rating wiki } pageInfo { total hasNextPage } } }`;
          const gqlData = await rawGraphql(graphqlQuery);
          const articlesNode = gqlData?.data?.articles;
          
          if (articlesNode && articlesNode.nodes) allArticles = allArticles.concat(articlesNode.nodes);
          if (articlesNode?.pageInfo) hasNextPage = articlesNode.pageInfo.hasNextPage;
          else hasNextPage = false;
          
          currentPage++;
        }

        if (allArticles.length === 0) return <template><quote id={messageId} />{rankLines.map((line: string) => <template>{line}<br /></template>)}<br />{wikidotId} 没有任何作品。</template>;

        const localBannedTitles = config.bannedTitles || [];
        const validArticles = allArticles.filter((a: any) => !localBannedTitles.includes(a.title));

        if (validArticles.length === 0) return <template><quote id={messageId} />{rankLines.map((line: string) => <template>{line}<br /></template>)}<br />{wikidotId} 没有符合条件的作品。</template>;

        const headerNode = (
          <template>
            {rankLines.map((line: string) => <template>{line}<br /></template>)}
            <br />{wikidotId} 的作品一览（共抓取 {validArticles.length} 篇）：
          </template>
        );

        if (validArticles.length > 20) {
          const chunkSize = 80;
          const chunks = [];
          for (let i = 0; i < validArticles.length; i += chunkSize) chunks.push(validArticles.slice(i, i + chunkSize));

          return (
            <message forward>
              <message>{headerNode}</message>
              {chunks.map((chunk: any[], index: number) => (
                <message>
                  <template>
                    第 {index * chunkSize + 1} ~ {Math.min((index + 1) * chunkSize, validArticles.length)} 篇：<br />
                    {chunk.map((a: any) => <template>{a.title} 评分：{a.rating} 所属维基：{a.wiki}<br /></template>)}
                  </template>
                </message>
              ))}
            </message>
          );
        }

        return (
          <template>
            <quote id={messageId} />
            {headerNode}<br />
            {validArticles.map((a: any) => <template>{a.title} 评分：{a.rating} 所属维基：{a.wiki}<br /></template>)}
          </template>
        );
      } catch (err: any) {
        return <template><quote id={messageId} />请求数据出错：{err.message}</template>;
      }
    });
}