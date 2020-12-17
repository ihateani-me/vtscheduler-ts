import axios from "axios";
import { TwitcastingChannel, TwitcastingVideo, TWCastChannelProps, TWCastVideoProps } from "../models/twitcasting";
import { logger } from "../utils/logger";
import _ from "lodash";
import { isNone } from "../utils/swissknife";
import moment from "moment-timezone";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36";

export async function twcastLiveHeartbeat() {
    let session = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    })

    logger.info("twcastLiveHeartbeat() fetching channels and videos data...");
    let video_sets: TWCastVideoProps[] = await TwitcastingVideo.find({});
    let channels: TWCastChannelProps[] = await TwitcastingChannel.find({});
    if (channels.length < 1) {
        logger.warn("twcastLiveHeartbeat() no registered channels");
        return;
    }

    logger.info("twcastLiveHeartbeat() creating fetch jobs...");
    const channelPromises = channels.map((channel) => (
        session.get("https://twitcasting.tv/streamchecker.php", {
            params: {
                u: channel.id,
                v: 999
            },
            responseType: "text"
        })
        .then((textRes) => {
            return {"res": textRes.data, "id": channel.id, "group": channel.group};
        })
        .catch((err) => {
            logger.error(`twcastLiveHeartbeat() failed to status for ${channel.id}, error: ${err.toString()}`);
            return {"res": "", "id": channel.id, "group": channel.group};
        })
    ));

    const collectedLives = await Promise.all(channelPromises);
    let insertData: any[] = [];
    let updateData: any[] = [];
    let current_time = moment.tz("UTC").unix();
    for (let i = 0; i < collectedLives.length; i++) {
        let result = collectedLives[i];
        logger.info(`twcastLiveHeartbeat() parsing ${result.id}`);
        let splitted_data = result["res"].split("\t");
        if (splitted_data.length < 1) {
            continue;
        }
        if (splitted_data[0] === "") {
            continue;
        }

        let tw_sid = splitted_data[0];
        if (tw_sid === "7") {
            continue;
        }

        let tw_time_passed = parseInt(splitted_data[6]);
        let tw_max_viewers = parseInt(splitted_data[5]);
        let tw_current_viewers = parseInt(splitted_data[3]);
        let tw_title = decodeURIComponent(splitted_data[7]);
        let tw_thumbnail_fetch = await session.get(
            `https://apiv2.twitcasting.tv/users/${result.id}/live/thumbnail`, {
                params: {
                    "size": "large",
                    "position": "beginning"
                }
            }
        )
        let tw_thumbnail = tw_thumbnail_fetch.request.res.responseUrl;
        if (tw_title === "") {
            tw_title = `Radio Live #${tw_sid}`;
        }
        let tw_start_time = Math.round(current_time - tw_time_passed);

        let old_mappings = _.find(video_sets, {"id": tw_sid});
        if (!isNone(old_mappings)) {
            let mappedUpdate = {
                "id": tw_sid,
                "title": tw_title,
                "startTime": tw_start_time,
                "endTime": null,
                "viewers": tw_current_viewers,
                "peakViewers": tw_max_viewers,
                "thumbnail": tw_thumbnail,
            }
            updateData.push(mappedUpdate)
        } else {
            let insertUpdate = {
                "id": tw_sid,
                "title": tw_title,
                "startTime": tw_start_time,
                "endTime": null,
                "status": "live",
                "viewers": tw_current_viewers,
                "peakViewers": tw_max_viewers,
                "channel_id": result["id"],
                "thumbnail": tw_thumbnail,
                "group": result["group"],
                "platform": "twitcasting"
            }
            insertData.push(insertUpdate);
        }
    }

    logger.info("twcastLiveHeartbeat() checking old data for moving it to past streams...");
    let oldData = video_sets.map((oldRes) => {
        let updMap = _.find(updateData, {"id": oldRes["id"]});
        if (!isNone(updMap)) {
            return [];
        }
        return {
            "id": oldRes["id"],
            "status": "past",
            "startTime": oldRes["startTime"],
            "endTime": moment.tz("UTC").unix(),
        };
    });
    // @ts-ignore
    oldData = _.flattenDeep(oldData);
    updateData = _.concat(updateData, oldData);

    if (insertData.length > 0) {
        logger.info("twcastLiveHeartbeat() inserting new videos...");
        await TwitcastingVideo.insertMany(insertData).catch((err) => {
            logger.error(`twcastLiveHeartbeat() failed to insert new video to database.\n${err.toString()}`);
        });
    }
    if (updateData.length > 0) {
        logger.info("twcastLiveHeartbeat() updating existing videos...");
        const dbUpdateCommit = updateData.map((new_update) => (
            TwitcastingVideo.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    logger.error(`twcastLiveHeartbeat() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`twcastLiveHeartbeat() failed to update databases, ${err.toString()}`);
        })
    }   
}

export async function twcastChannelsStats() {
    let session = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    })

    logger.info("twcastChannelsStats() fetching channels data...");
    let channels: TWCastChannelProps[] = await TwitcastingChannel.find({});
    if (channels.length < 1) {
        logger.warn("twcastChannelsStats() no registered channels");
        return;
    }

    logger.info("twcastChannelsStats() creating fetch jobs...");
    const channelPromises = channels.map((channel) => (
        session.get(`https://frontendapi.twitcasting.tv/users/${channel.id}`, {
            params: {
                detail: "true",
            },
            responseType: "json"
        })
        .then((jsonRes) => {
            return jsonRes.data;
        })
        .catch((err) => {
            logger.error(`twcastChannelsStats() failed fetching for ${channel.id}, error: ${err.toString()}`);
            return {};
        })
    ));
    logger.info("twcastChannelsStats() executing API requests...");
    const collectedChannels = (await Promise.all(channelPromises)).filter(res => Object.keys(res).length > 0);
    let updateData = [];
    for (let i = 0; i < collectedChannels.length; i++) {
        let result = collectedChannels[i];
        if (!_.has(result, "user")) {
            continue;
        }

        let udata = result["user"];
        let desc = "";
        if (_.has(udata, "description") && !isNone(udata["description"]) && udata["description"] !== "") {
            desc = udata["description"]
        }
        let profile_img: string = udata["image"]
        if (profile_img.startsWith("//")) {
            profile_img = "https:" + profile_img
        }
        let mappedUpdate = {
            "id": udata["id"],
            "name": udata["name"],
            "description": desc,
            "thumbnail": profile_img,
            "followerCount": udata["backerCount"],
            "level": udata["level"],
        }
        updateData.push(mappedUpdate);
    }

    if (updateData.length > 0) {
        logger.info("twcastChannelsStats() updating channels...");
        const dbUpdateCommit = updateData.map((new_update) => (
            // @ts-ignore
            TwitchVideo.findOneAndUpdate({"id": {"$eq": new_update.id}}, new_update, null, (err) => {
                if (err) {
                    // @ts-ignore
                    logger.error(`twcastChannelsStats() failed to update ${new_update.id}, ${err.toString()}`);
                    return;
                } else {
                    return;
                }
            })
        ))
        await Promise.all(dbUpdateCommit).catch((err) => {
            logger.error(`twcastChannelsStats() failed to update databases, ${err.toString()}`);
        })
    }
}