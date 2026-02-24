import { Context, Schema } from "koishi";
import {} from "koishi-plugin-adapter-onebot";
import { queries } from "./graphql";
import { branchInfo, wikitApiRequest } from "./lib";

import type { Event } from "@satorijs/protocol";
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
}

export const Config: Schema<Config> = Schema.object({
  bannedUsers: Schema.array(Schema.string()).description("禁止查询的用户列表"),
  bannedTitles: Schema.array(Schema.string()).description("禁止查询的文章列表"),
  bannedTags: Schema.array(Schema.string()).description("禁止查询的标签列表"),
}).description("禁止查询配置");

export function apply(ctx: Context, config: Config): void {
  ctx.model.extend("wikitQuerier", {
    id: "unsigned",
    platform: "string(64)",
    channelId: "string(64)",
    defaultBranch: "string(64)",
  });

  const getDefaultBranch = async (session: Session): Promise<string | undefined> => {
    const platform = session.event.platform;
    const channelId = session.event.channel.id;

    const data = await ctx.database.get("wikitQuerier", {
      platform,
      channelId,
    });

    if (data.length > 0) {
      return data[0].defaultBranch;
    }

    return undefined;
  };
  
  let cmd = ctx.command('wikit')
  cmd
  .subcommand("wikit-list", "列出所有支持的网站及对应的地址。")
  .action(async (argv: Argv): Promise<string> => {
    const entries = Object.entries(branchInfo);
    if (entries.length === 0) return "当前没有配置任何维基信息。";

    const lines = entries.map(([key, value]) => `${key} → https://${value.wiki}.wikidot.com/`);
    return `支持的维基列表：\n${lines.join("\n")}`;
  });

  cmd
    .subcommand("wikit-default-branch <分部名称:string>", "设置默认分部。")
    .alias("wikit-db")
    .action(async (argv: Argv, branch: string): Promise<string> => {
      const platform: string = argv.session.event.platform;
      const channelId: string = argv.session.event.channel.id;
      if (!branch || !Object.keys(branchInfo).includes(branch) || branch === "all") {
        return "分部名称不正确。";
      }
      ctx.database.upsert("wikitQuerier", [{ channelId, platform, defaultBranch: branch }], ["platform", "channelId"]);
      return `已将本群默认查询分部设置为: ${branch}`;
    });

  cmd
    .subcommand("wikit-author <作者:string> [分部名称:string]", "查询作者信息。\n默认搜索后室中文站。")
    .alias("wikit-au")
    .action(async (argv: Argv, author: string, branch: string | undefined): Promise<h> => {
      // const branchUrl: string = await getBranchUrl(branch, argv.args.at(-1), argv.session.event);

      const isRankQuery: boolean = /^#[0-9]{1,15}$/.test(author);
      const rankNumber: number | null = isRankQuery ? Number(author.slice(1)) : null;
      const queryString: string = isRankQuery ? queries.userRankQuery : queries.userQuery;

      const authorName: string =
        (branch && !Object.keys(branchInfo).includes(branch)) || !author ?
          Object.keys(branchInfo).includes(argv.args.at(-1)) ?
            argv.args.slice(0, -1).join(" ")
          : argv.args.join(" ")
        : author;

      const User = ({ object }: { object: UserQueryResponse & UserRankQueryResponse }): h => {
        const dataArray: AuthorRank[] = object.authorRanking ?
          object.authorRanking
        : object.authorWikiRank ? [object.authorWikiRank] : [];

        if (!dataArray || dataArray.length === 0) {
          return <template>未找到用户。</template>;
        }

        let user: AuthorRank | undefined;
        if (rankNumber !== null) {
          user = dataArray.find(
            (u) =>
              u.rank === rankNumber &&
              !config.bannedUsers.includes(u.name)
          );
        } else {
          user = dataArray.find(
            (u) =>
              !config.bannedUsers.includes(u.name)
          );
        }
        if (!user) {
          return <template>未找到用户。</template>;
        }
        
        return (
          <template>
            <quote id={argv.session.event.message.id} />
            {user.name} (#{user.rank})
            <br />
            总分：{user.value}
          </template>
        );
      };

      try {
        let finalBranch = branch;
        if (!finalBranch) {
          finalBranch = await getDefaultBranch(argv.session);
        }
        const result = await wikitApiRequest(authorName, finalBranch, 0, queryString);
        const response = <User object={result as UserQueryResponse & UserRankQueryResponse} />;

        const sentMessages = await argv.session.send(response);
        scheduleChecks(0, argv.session, sentMessages[0]);

        return;
      } catch (err) {
        return <template>查询失败: {err.message || "未知错误"}</template>;
      }
    });

  cmd
    .subcommand("wikit-search <标题:string> [分部名称:string]", "查询文章信息。\n默认搜索后室中文站。")
    .alias("wikit-sr")
    .action(async (argv: Argv, title: string, branch: string | undefined): Promise<h> => {
      // const branchUrl = await getBranchUrl(branch, argv.args.at(-1), argv.session.event);
      const titleName: string =
        (branch && !Object.keys(branchInfo).includes(branch)) || !title ?
          Object.keys(branchInfo).includes(argv.args.at(-1)) ?
            argv.args.slice(0, -1).join(" ")
          : argv.args.join(" ")
        : title;

      const Author = ({ authorName }: { authorName: string }): h => {
        return <template>作者：{authorName || "已注销用户"}</template>;
      };

      const TitleProceed = ({ titleData }: { titleData: TitleQueryResponse }): h => {
        const articles: Article[] = titleData?.articles?.nodes;
        if (!articles || articles.length === 0) {
          return <template>未找到文章。</template>;
        }

        const selectedIndex: number = articles.findIndex((article: Article): boolean => {
          const isBannedTitle: boolean = config.bannedTitles.includes(article.title);
          const isBannedUser: boolean = config.bannedUsers.includes(article.author);
          return !(isBannedTitle || isBannedUser);
        });

        if (selectedIndex === -1) {
          return <template>未找到符合条件的文章。</template>;
        }

        const article: Article = articles[selectedIndex];

        return (
          <template>
            <quote id={argv.session.event.message.id} />
            {article.title}
            <br />
            评分：{article.rating}
            <br />
            <Author authorName={article.author} />
            <br />
            {normalizeUrl(article.url)}
          </template>
        );
      };

      try {
        let finalBranch = branch;
        if (!finalBranch) {
           finalBranch = await getDefaultBranch(argv.session);
        }
        const result = await wikitApiRequest(titleName, branch, 0, queries.titleQuery);
        const response: h = <TitleProceed titleData={result as TitleQueryResponse} />;

        const sentMessages = await argv.session.send(response);
        scheduleChecks(0, argv.session, sentMessages[0]);

        return;
      } catch (err) {
        return <template>查询失败：{err.message || "未知错误"}</template>;
      }
    });

  const checkTimes = [10000, 30000, 60000, 90000, 11000, 12000];

  const checkAndDelete = async (session: Session, sentMessage: string): Promise<boolean> => {
    try {
      const message = await session.onebot.getMsg(session.messageId);

      if ((message as unknown as { raw_message: string })?.raw_message === "") {
        await session.onebot.deleteMsg(sentMessage);
        return true;
      }
      return false;
    } catch (error) {
      ctx.logger("wikit-querier").warn("检测或撤回消息失败:", error);
      return false;
    }
  };

  const scheduleChecks = (index: number, session: Session, sentMessage: string): void => {
    if (index >= checkTimes.length) return;

    ctx.setTimeout(
      async (): Promise<void> => {
        const deleted = await checkAndDelete(session, sentMessage);
        if (!deleted) {
          scheduleChecks(index + 1, session, sentMessage);
        }
      },
      index === 0 ? checkTimes[0] : checkTimes[index] - checkTimes[index - 1],
    );
  };
}
