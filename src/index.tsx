import { Context, Schema } from "koishi";
import {} from "koishi-plugin-adapter-onebot";
import { queries } from "./graphql";
import { branchInfo, wikitApiRequest } from "./lib";

import type { Argv, h, Session } from "koishi";
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
  defaultBranch: string;
}

export const name: string = "wikit-querier";

export const inject: string[] = ["database"];

export interface Config {
  bannedUsers: string[];
  bannedTitles: string[];
  bannedTags: string[];
  bannedQQs: string[];
  bannedWikidots: string[];
}

export const Config: Schema<Config> = Schema.object({
  bannedUsers: Schema.array(Schema.string()).description("禁止查询的用户列表"),
  bannedTitles: Schema.array(Schema.string()).description("禁止查询的文章列表"),
  bannedTags: Schema.array(Schema.string()).description("禁止查询的标签列表"),
  bannedQQs: Schema.array(Schema.string()).description("禁止绑定的QQ号黑名单"),
  bannedWikidots: Schema.array(Schema.string()).description("禁止绑定的Wikidot账号黑名单"),
}).description("禁止查询配置");

export function apply(ctx: Context, config: Config): void {
  ctx.model.extend("wikitQuerier", {
    id: "unsigned",
    platform: "string(64)",
    channelId: "string(64)",
    defaultBranch: "string(64)",
  });

  const normalizeUrl = (url: string): string =>
    url
      .replace(/^https?:\/\/backrooms-wiki-cn.wikidot.com/, "https://brcn.backroomswiki.cn")
      .replace(/^https?:\/\/scp-wiki-cn.wikidot.com/, "https://scpcn.backroomswiki.cn")
      .replace(/^https?:\/\/([a-z]+-wiki-cn|nationarea)/, "https://$1");
  
  const getDefaultBranch = async (session: Session): Promise<string | undefined> => {
    const platform = session.event.platform;
    const channelId = session.event.channel.id;
    const data = await ctx.database.get("wikitQuerier", { platform, channelId });
    return data.length > 0 ? data[0].defaultBranch : undefined;
  };

  let cmd = ctx.command('wikit');
  
  cmd
  .subcommand("wikit-list", "列出所有支持的网站。")
  .action(async (): Promise<string> => {
    const entries = Object.entries(branchInfo);
    const lines = entries.map(([key, value]) => `${key} → https://${value.wiki}.wikidot.com/`);
    return `支持的维基列表：\n${lines.join("\n")}`;
  });

  cmd
    .subcommand("wikit-default-branch <维基名称:string>", "设置默认维基。")
    .alias("wikit-db")
    .action(async (argv: Argv, branch: string): Promise<string> => {
      const platform = argv.session.event.platform;
      const channelId = argv.session.event.channel.id;
      if (!branch || !Object.keys(branchInfo).includes(branch) || branch === "all") return "维基名称不正确。";
      ctx.database.upsert("wikitQuerier", [{ channelId, platform, defaultBranch: branch }], ["platform", "channelId"]);
      return `已将本群默认查询维基设置为: ${branch}`;
    });

cmd
    .subcommand("wikit-verify", "获取维基绑定链接")
    .alias("wikit-v")
    .action(async ({ session }): Promise<string> => {
      const qq = session.userId;
      const messageId = session.messageId;
      const channelId = session.channelId;

      if (config.bannedQQs.includes(qq)) {
        return `<quote id="${messageId}" /><at id="${qq}" /> 你的QQ号已被列入黑名单，无法获取绑定链接。`;
      }

      const token = "none";

      try {
        const response = await fetch("https://wikit.unitreaty.org/module/qq-verify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ qq, token }).toString(),
        });

        const rawText = await response.text();
        let data;
        try { 
          data = JSON.parse(rawText); 
        } catch { 
          return `<quote id="${messageId}" /><at id="${qq}" /> 服务器异常返回：\n${rawText}`; 
        }

        if (data.status === "success") {
          const checkIntervals = [
            15000, 
            25000, 25000, 
            30000, 30000, 
            40000, 40000, 40000, 40000, 40000, 
            40000, 40000, 40000, 40000, 40000
          ];

          const pollCheck = (index: number) => {
            if (index >= checkIntervals.length) {
              console.log(`[Wikit 调试] QQ ${qq} 轮询结束，已达到最大次数，未查到绑定信息。`);
              return; 
            }

            ctx.setTimeout(async () => {
              try {
                const queryRes = await fetch(`https://wikit.unitreaty.org/module/bind-query?qq=${qq}`);
                const queryText = await queryRes.text();
                
                let queryData;
                try {
                  queryData = JSON.parse(queryText);
                } catch (e) {
                  pollCheck(index + 1);
                  return;
                }

                const userInfo = queryData[qq] || queryData.data || queryData;

                if (userInfo && userInfo.id) {
                  await session.bot.sendMessage(
                    channelId,
                    `<quote id="${messageId}" /><at id="${qq}" /> 绑定成功！已为你绑定维基ID：${userInfo.id}`
                  );
                  return;
                } else {
                  pollCheck(index + 1);
                }
              } catch (err) {
                console.log(`[Wikit 调试] 请求发生错误: ${err.message}`);
                pollCheck(index + 1);
              }
            }, checkIntervals[index]);
          };

          pollCheck(0);

          return `<quote id="${messageId}" /><at id="${qq}" /> 验证请求成功！\n你的QQ：${qq}\n请点击以下链接完成绑定：\n${data["verification-link"]}`;
        }
        
        return `<quote id="${messageId}" /><at id="${qq}" /> 验证失败：${data.message || rawText}`;
      } catch (err) { 
        return `<quote id="${messageId}" /><at id="${qq}" /> 请求出错：${err.message}`; 
      }
    });

  cmd
    .subcommand("wikit-unbind", "解除维基账号绑定")
    .alias("wikit-ub")
    .action(async ({ session }): Promise<string> => {
      const qq = session.userId;
      const messageId = session.messageId;

      if (config.bannedQQs.includes(qq)) {
        return `<quote id="${messageId}" /><at id="${qq}" /> 你的QQ号已被列入黑名单，无法进行解绑操作。`;
      }

      const token = "none";

      try {
        const response = await fetch("https://wikit.unitreaty.org/module/qq-unbind", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ qq, token }).toString(),
        });

        const rawText = await response.text();
        let data;
        try { 
          data = JSON.parse(rawText); 
        } catch { 
          const isSuccess = rawText.includes("success");
          return `<quote id="${messageId}" /><at id="${qq}" /> ${isSuccess ? '解绑成功！' : '解绑失败：\n' + rawText}`;
        }

        if (data.status === "success") {
          return `<quote id="${messageId}" /><at id="${qq}" /> 解绑成功！\n你的QQ：${qq}\n已解除与维基账号的绑定。`;
        } else {
          return `<quote id="${messageId}" /><at id="${qq}" /> 解绑失败！\n返回信息：${data.message || rawText}`;
        }
      } catch (err) { 
        return `<quote id="${messageId}" /><at id="${qq}" /> 请求出错：${err.message}`; 
      }
    });

cmd
    .subcommand("wikit-info", "查看维基绑定信息")
    .alias("wikit-i")
    .option("qq", "-q <qq:string> 通过QQ号查询")
    .option("wd", "-w <wd:string> 通过Wikidot账号查询")
    .option("all", "-a 查询所有绑定记录(仅限代码指定用户)")
    .action(async ({ session, options }): Promise<h> => {
      const senderId = session.userId;
      const messageId = session.messageId;

      // 在这里添加允许使用 -a 指令的 QQ 号列表
      const adminList = ["86599608"];

      // 1. 处理查询全部绑定记录的逻辑 (-a)
      if (options.all) {
        if (!adminList.includes(senderId)) {
          return <template><quote id={messageId} />权限不足，你无法使用查询所有记录的功能。</template>;
        }

        try {
          const res = await fetch("https://wikit.unitreaty.org/module/bind-query?all=1");
          const rawText = await res.text();
          let resData;
          try {
            resData = JSON.parse(rawText);
          } catch (e) {
            return <template><quote id={messageId} />服务器返回异常：<br />{rawText}</template>;
          }

          if (resData.status === "success" && resData.data && Array.isArray(resData.data)) {
            const list = resData.data;
            
            if (list.length === 0) {
              return <template><quote id={messageId} />当前没有任何绑定记录。</template>;
            }

            const contentNode = (
              <template>
                全站绑定记录一览（共 {resData.count || list.length} 条）：<br />
                {list.map((item: any) => {
                  const bindTime = new Date(item.bind_time * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
                  return <template>QQ: {item.qq} | ID: {item.id} | 时间: {bindTime}<br /></template>;
                })}
              </template>
            );

            // 如果全站绑定记录超过 20 条，则使用合并转发防止刷屏
            if (list.length > 20) {
              return (
                <message forward>
                  <message>{contentNode}</message>
                </message>
              );
            }

            return <template><quote id={messageId} />{contentNode}</template>;
          }
          return <template><quote id={messageId} />查询全部记录失败，未获取到有效数据。</template>;
        } catch (err) {
          return <template><quote id={messageId} />请求出错：{err.message}</template>;
        }
      }

      // 2. 原有的普通查询逻辑 (-q 或 -w)
      let url = "";
      let queryType = "";
      let queryValue = "";

      if (options.wd) {
        url = `https://wikit.unitreaty.org/module/bind-query?id=${options.wd}`;
        queryType = "Wikidot账号";
        queryValue = options.wd;
        
        if (config.bannedWikidots && config.bannedWikidots.includes(queryValue)) {
          return <template><quote id={messageId} />该{queryType}已被列入黑名单，无法查询绑定信息。</template>;
        }
      } else {
        const targetQq = options.qq || senderId;
        url = `https://wikit.unitreaty.org/module/bind-query?qq=${targetQq}`;
        queryType = "QQ号";
        queryValue = targetQq;

        if (config.bannedQQs && config.bannedQQs.includes(queryValue)) {
          return <template><quote id={messageId} />该{queryType}已被列入黑名单，无法查询绑定信息。</template>;
        }
      }

      try {
        const response = await fetch(url);
        const rawText = await response.text();
        
        let resData;
        try {
          resData = JSON.parse(rawText);
        } catch (e) {
          return <template><quote id={messageId} />查询失败，服务器返回异常：<br />{rawText}</template>;
        }

        if (resData.status === "success" && resData.data) {
          let info = resData.data;

          if (Array.isArray(info)) {
            info = info[0];
          } else if (typeof info === "object" && info !== null && !info.qq) {
            const keys = Object.keys(info);
            if (keys.length > 0) {
              info = info[keys[0]];
            }
          }

          if (!info || (!info.qq && !info.id)) {
            return <template><quote id={messageId} />未查询到该 {queryType} ({queryValue}) 的绑定记录。</template>;
          }

          const bindTime = new Date(info.bind_time * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
          
          return <template><quote id={messageId} />查询成功！<br />QQ号：{info.qq}<br />维基ID：{info.id}<br />绑定时间：{bindTime}</template>;
        } else {
          return <template><quote id={messageId} />未查询到该 {queryType} ({queryValue}) 的绑定记录。</template>;
        }
      } catch (err) {
        return <template><quote id={messageId} />请求出错：{err.message}</template>;
      }
    });


  cmd
    .subcommand("wikit-author <作者:string> [维基名称:string]", "查询作者。")
    .alias("wikit-au")
    .action(async (argv: Argv, author: string, branch: string | undefined): Promise<h> => {
      const isRankQuery = /^#[0-9]{1,15}$/.test(author);
      const rankNumber = isRankQuery ? Number(author.slice(1)) : null;
      let queryString = isRankQuery ? queries.userRankQuery : queries.userQuery;

      const validBranches = ["all", ...Object.keys(branchInfo)];
      const authorName = (branch && !validBranches.includes(branch)) || !author ?
          (validBranches.includes(argv.args.at(-1)) ? argv.args.slice(0, -1).join(" ") : argv.args.join(" ")) : author;

      try {
        let finalBranch = branch || await getDefaultBranch(argv.session);
        if (!finalBranch || finalBranch === "all") {
          queryString = isRankQuery ? queries.userRankQuery : queries.userGlobalQuery;
          finalBranch = "all"; 
        }

        let result = await wikitApiRequest(authorName, finalBranch, 0, queryString);

        if (isRankQuery && (result as UserRankQueryResponse).authorRanking) {
          const rankData = result as UserRankQueryResponse;
          const matchedUser = rankData.authorRanking.find(u => u.rank === rankNumber && !config.bannedUsers.includes(u.name));
          if (matchedUser) {
            let secondQuery = (!finalBranch || finalBranch === "all") ? queries.userGlobalQuery : queries.userQuery;
            result = await wikitApiRequest(matchedUser.name, finalBranch, 0, secondQuery);
          }
        }

        const data = result as UserQueryResponse & UserRankQueryResponse;
        const user = (data.authorRanking?.find(u => u.rank === rankNumber) || data.authorGlobalRank || data.authorWikiRank);

        if (!user || config.bannedUsers.includes(user.name)) return <template>未找到用户。</template>;
        
        const total = data.articles?.pageInfo?.total ?? 0;
        const average = total > 0 ? (user.value / total).toFixed(2) : 0;

        return (
          <template>
            <quote id={argv.session.event.message.id} />
            {user.name} (#{user.rank})<br />总分：{user.value} 页面数：{total} 平均分：{average}
          </template>
        );
      } catch (err) {
        return <template>查询失败: {err.message}</template>;
      }
    });

  cmd
    .subcommand("wikit-search <标题:string> [维基名称:string]", "查询文章。")
    .alias("wikit-sr")
    .action(async (argv: Argv, title: string, branch: string | undefined): Promise<h> => {
      const titleName = (branch && !Object.keys(branchInfo).includes(branch)) || !title ?
          (Object.keys(branchInfo).includes(argv.args.at(-1)) ? argv.args.slice(0, -1).join(" ") : argv.args.join(" ")) : title;

      try {
        let finalBranch = branch || await getDefaultBranch(argv.session);
        const result = await wikitApiRequest(titleName, finalBranch, 0, queries.titleQuery);
        const articles = (result as TitleQueryResponse)?.articles?.nodes;

        if (!articles || articles.length === 0) return <template>未找到文章。</template>;
        const article = articles.find(a => !config.bannedTitles.includes(a.title) && !config.bannedUsers.includes(a.author));

        if (!article) return <template>未找到符合条件的文章。</template>;

        return (
          <template>
            <quote id={argv.session.event.message.id} />
            {article.title}<br />评分：{article.rating}<br />作者：{article.author || "已注销"}<br />{normalizeUrl(article.url)}
          </template>
        );
      } catch (err) {
        return <template>查询失败：{err.message}</template>;
      }
    });
cmd
    .subcommand("wikit-self", "查询作品与评分一览。")
    .alias("wikit-sf")
    .option("qq", "-q <qq:string> 通过QQ号查询")
    .option("wd", "-w <wd:string> 通过Wikidot账号查询")
    .action(async ({ session, options }): Promise<h> => {
      const senderId = session.userId;
      const messageId = session.messageId;

      let wikidotId = "";

      // 1. 确定要查询的 Wikidot ID
      if (options.wd) {
        wikidotId = options.wd;
        if (config.bannedWikidots && config.bannedWikidots.includes(wikidotId)) {
          return <template><quote id={messageId} />该Wikidot账号已被列入黑名单，无法查询。</template>;
        }
      } else {
        const targetQq = options.qq || senderId;
        if (config.bannedQQs && config.bannedQQs.includes(targetQq)) {
          return <template><quote id={messageId} />该QQ号已被列入黑名单，无法查询。</template>;
        }

        try {
          const bindRes = await fetch(`https://wikit.unitreaty.org/module/bind-query?qq=${targetQq}`);
          const bindText = await bindRes.text();
          
          let bindData;
          try {
            bindData = JSON.parse(bindText);
          } catch (e) {
            return <template><quote id={messageId} />绑定信息解析失败。</template>;
          }

          if (bindData.status !== "success" || !bindData.data) {
            const errorMsg = options.qq ? `未查询到QQ ${targetQq} 的绑定记录。` : "未查询到你的绑定记录，请先绑定账号。";
            return <template><quote id={messageId} />{errorMsg}</template>;
          }

          let infoList = Array.isArray(bindData.data) ? bindData.data : [bindData.data];
          if (infoList.length === 0 || !infoList[0] || !infoList[0].id) {
            return <template><quote id={messageId} />未查询到有效的绑定记录。</template>;
          }

          wikidotId = infoList[0].id;
        } catch (err) {
          return <template><quote id={messageId} />请求绑定接口出错：{err.message}</template>;
        }
      }

      // 2. 查询排名
      let rankLines: string[] = [];
      try {
        const rankRes = await fetch(`https://wikit.unitreaty.org/wikidot/rank?user=${wikidotId}`);
        const rankText = await rankRes.text();
        const cleanText = rankText.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
        rankLines = cleanText.trim().split("\n").filter(line => line.trim() !== "");
      } catch (e) {
        rankLines = ["排名信息获取失败。"];
      }

      // 3. 循环拉取所有作品
      try {
        let allArticles: any[] = [];
        let currentPage = 1;
        let hasNextPage = true;
        let totalCount = 0;
        const maxPages = 30;

        while (hasNextPage && currentPage <= maxPages) {
          const graphqlQuery = `query { articles(author: "${wikidotId}", page: ${currentPage}, pageSize: 100) { nodes { title rating wiki } pageInfo { total hasNextPage } } }`;
          const gqlRes = await fetch("https://wikit.unitreaty.org/apiv1/graphql", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: graphqlQuery }),
          });
          
          const gqlData = await gqlRes.json();
          const articlesNode = gqlData?.data?.articles;
          
          if (articlesNode && articlesNode.nodes) {
            allArticles = allArticles.concat(articlesNode.nodes);
          }
          
          if (articlesNode?.pageInfo) {
            totalCount = articlesNode.pageInfo.total || totalCount;
            hasNextPage = articlesNode.pageInfo.hasNextPage;
          } else {
            hasNextPage = false;
          }
          
          currentPage++;
        }

        if (allArticles.length === 0) {
          return (
            <template>
              <quote id={messageId} />
              {rankLines.map((line: string) => <template>{line}<br /></template>)}
              <br />
              {wikidotId} 没有任何作品。
            </template>
          );
        }

        const validArticles = allArticles.filter((a: any) => !config.bannedTitles.includes(a.title));

        if (validArticles.length === 0) {
          return (
            <template>
              <quote id={messageId} />
              {rankLines.map((line: string) => <template>{line}<br /></template>)}
              <br />
              {wikidotId} 没有符合条件的作品。
            </template>
          );
        }

        // 拼接输出内容
        const contentNode = (
          <template>
            {rankLines.map((line: string) => <template>{line}<br /></template>)}
            <br />
            {wikidotId} 的作品一览（共抓取 {validArticles.length} 篇）：<br />
            {validArticles.map((a: any) => (
              <template>{a.title} 评分：{a.rating} 所属维基：{a.wiki}<br /></template>
            ))}
          </template>
        );

        // 如果文章数大于 20，调用合并转发
        if (validArticles.length > 20) {
          return (
            <message forward>
              <message>{contentNode}</message>
            </message>
          );
        }

        // 否则普通回复
        return (
          <template>
            <quote id={messageId} />
            {contentNode}
          </template>
        );
      } catch (err) {
        return <template><quote id={messageId} />请求数据出错：{err.message}</template>;
      }
    });
}
