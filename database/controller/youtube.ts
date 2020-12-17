import axios from "axios";
import _ from "lodash";
import { YoutubeChannel, YTChannelProps } from "../../src/models";
import { logger } from "../../src/utils/logger";
import { fallbackNaN, filterEmpty } from "../../src/utils/swissknife";
import { VTuberModel } from "../dataset/model";
import { version as vt_version } from "../../package.json";
import { YTRotatingAPIKey } from "../../src/utils/ytkey_rotator";

interface AnyDict {
    [key: string]: any;
}

function getBestThumbnail(thumbnails: any, video_id: string): string {
    if (_.has(thumbnails, "maxres")) {
        return thumbnails["maxres"]["url"];
    } else if (_.has(thumbnails, "standard")) {
        return thumbnails["standard"]["url"];
    } else if (_.has(thumbnails, "high")) {
        return thumbnails["high"]["url"];
    } else if (_.has(thumbnails, "medium")) {
        return thumbnails["medium"]["url"];
    } else if (_.has(thumbnails, "default")) {
        return thumbnails["default"]["url"];
    }
    return `https://i.ytimg.com/vi/${video_id}/maxresdefault.jpg`;
}

export async function youtubeChannelDataset(dataset: VTuberModel[], apiKeys: YTRotatingAPIKey) {
    let session = axios.create({
        headers: {
            "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`
        }
    })

    let parsed_yt_channel: YTChannelProps[] = await YoutubeChannel.find({"group": {"$eq": dataset[0].id}});
    let all_parsed_ids = _.map(parsed_yt_channel, "id");

    let toBeParsed = dataset.map((data) => {
        // @ts-ignore
        if (all_parsed_ids.includes(data["youtube"])) {
            return null;
        }
        return {"id": data["youtube"], "group": data["id"]};
    });

    toBeParsed = filterEmpty(toBeParsed);
    if (toBeParsed.length < 1) {
        logger.warn("youtubeChannelDataset() no new channels to be registered");
        return;
    }

    const chunked_channels_set = _.chunk(toBeParsed, 40);
    logger.info(`youtubeChannelDataset() checking channels with total of ${toBeParsed.length} channels (${chunked_channels_set.length} chunks)...`);
    const items_data_promises = chunked_channels_set.map((chunks, idx) => (
        session.get("https://www.googleapis.com/youtube/v3/channels", {
            params: {
                part: "snippet,statistics",
                id: _.join(_.map(chunks, "id"), ","),
                maxResults: 50,
                key: apiKeys.get()
            },
            responseType: "json"
        })
        .then((result) => {
            let yt_result = result.data;
            let items = yt_result["items"].map((res: any) => {
                // @ts-ignore
                let channel_data = _.find(toBeParsed, {"id": res.id});
                // @ts-ignore
                res["groupData"] = channel_data["group"];
                return res;
            })
            return items;
        }).catch((err) => {
            logger.error(`youtubeChannelDataset() failed to fetch info for chunk ${idx}, error: ${err.toString()}`);
            return [];
        })
    ))

    let items_data: any[] = await Promise.all(items_data_promises).catch((err) => {
        logger.error(`youtubeChannelDataset() failed to fetch from API, error: ${err.toString()}`)
        return [];
    });
    if (items_data.length < 1) {
        logger.warn("youtubeChannelDataset() no response from API");
        return;
    }

    items_data = _.flattenDeep(items_data);
    logger.info(`youtubeChannelDataset() preparing update...`);
    const to_be_committed = items_data.map((res_item) => {
        let ch_id = res_item["id"];
        let snippets: AnyDict = res_item["snippet"];
        let statistics: AnyDict = res_item["statistics"];

        let title = snippets["title"];
        let desc = snippets["description"];
        let pubAt = snippets["publishedAt"]
        let group = res_item["groupData"];

        let thumbs = getBestThumbnail(snippets["thumbnails"], "");
        let subsCount = 0,
            viewCount = 0,
            videoCount = 0;

        if (_.has(statistics, "subscriberCount")) {
            subsCount = fallbackNaN(parseInt, statistics["subscriberCount"], statistics["subscriberCount"]);
        }

        // @ts-ignore
        let finalData: YTChannelProps = {
            id: ch_id,
            name: title,
            description: desc,
            publishedAt: pubAt,
            thumbnail: thumbs,
            subscriberCount: subsCount,
            viewCount: viewCount,
            videoCount: videoCount,
            group: group,
            platform: "youtube"
        }
        return finalData;
    })

    logger.info(`youtubeChannelDataset() committing new data...`);
    await YoutubeChannel.insertMany(to_be_committed).catch((err) => {
        logger.error(`youtubeChannelDataset() failed to insert new data, ${err.toString()}`);
    });
}
