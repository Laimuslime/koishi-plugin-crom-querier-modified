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

  const normalizeUrl = (url: string): string =>
    url
      .replace(/^https?:\/\/backrooms-wiki-cn.wikidot.com/, "https://brcn.backroomswiki.cn")
      .replace(/^https?:\/\/scp-wiki-cn.wikidot.com/, "https://scpcn.backroomswiki.cn")
      .replace(/^https?:\/\/([a-z]+-wiki-cn|nationarea)/, "https://$1");

  // const getBranchUrl = async (
  //   branch: string | undefined,
  //   lastStr: string | undefined,
  //   { platform, channel: { id: channelId } }: Event,
  // ): Promise<string> => {
  //   const branchUrls: CromQuerierTable[] = await ctx.database.get("cromQuerier", { platform, channelId });
  //   if (Object.keys(branchInfo).includes(lastStr)) {
  //     return branchInfo[lastStr].url;
  //   } else if (branch && Object.keys(branchInfo).includes(branch)) {
  //     return branchInfo[branch].url;
  //   } else if (branchUrls.length > 0) {
  //     return branchInfo[branchUrls[0].defaultBranch].url;
  //   } else {
  //     return branchInfo.cn.url;
  //   }
  // };
  let cmd = ctx.command('wikit')

  cmd
    .subcommand("default-branch <分部名称:string>", "设置默认分部。")
    .alias("默认分部")
    .alias("默认")
    .alias("db")
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
    .subcommand("author <作者:string> [分部名称:string]", "查询作者信息。\n默认搜索后室中文站。")
    .alias("作者")
    .alias("作")
    .alias("au")
    .action(async (argv: Argv, author: string, branch: string | undefined): Promise<h> => {
      // const branchUrl: string = await getBranchUrl(branch, argv.args.at(-1), argv.session.event);

      const isRankQuery: boolean = /^#[0-9]{1,15}$/.test(author);
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

        const selectedIndex: number = dataArray.findIndex(
          (user: AuthorRank): boolean => !config.bannedUsers.some((banned: string): boolean => user.name === banned),
        );

        if (selectedIndex === -1) {
          return <template>未找到符合条件的用户。</template>;
        }

        const user: AuthorRank = dataArray[selectedIndex];

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
        const result = await wikitApiRequest(authorName, branch, 0, queryString);
        const response = <User object={result as UserQueryResponse & UserRankQueryResponse} />;

        const sentMessages = await argv.session.send(response);
        scheduleChecks(0, argv.session, sentMessages[0]);

        return;
      } catch (err) {
        return <template>查询失败: {err.message || "未知错误"}</template>;
      }
    });

  cmd
    .subcommand("search <标题:string> [分部名称:string]", "查询文章信息。\n默认搜索后室中文站。")
    .alias("搜索")
    .alias("搜")
    .alias("sr")
    .action(async (argv: Argv, title: string, branch: string | undefined): Promise<h> => {
      // const branchUrl = await getBranchUrl(branch, argv.args.at(-1), argv.session.event);
      const titleName: string =
        (branch && !Object.keys(branchInfo).includes(branch)) || !title ?
          Object.keys(branchInfo).includes(argv.args.at(-1)) ?
            argv.args.slice(0, -1).join(" ")
          : argv.args.join(" ")
        : title;

      const Author = ({ authorName }: { authorName: string }): h => {
        return <template>作者：{authorName || "未知"}</template>;
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
