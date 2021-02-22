import { createSchema, Type, typedModel, ExtractProps } from "ts-mongoose";
import { FiltersDataConfig, PlatformData } from "./extras";

const ChannelsSchema = createSchema(
    {
        id: Type.string({ required: true }),
        room_id: Type.string(), // Bilibili Specific
        user_id: Type.string(), // Twitch Specific
        name: Type.string({required: true}),
        en_name: Type.string(),
        description: Type.string(),
        publishedAt: Type.string(), // YT/TTV/B2 Specific
        subscriberCount: Type.number(),
        viewCount: Type.number(),
        videoCount: Type.number(),
        followerCount: Type.number(), // TWCast/Mildom specific
        level: Type.number(), // Mildom/TWCast specific
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
        is_live: Type.boolean(), // B2 Specific
    }
)

const ChannelStatsHistorySchema = createSchema(
    {
        id: Type.string({ required: true }),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            subscriberCount: Type.number(),
            viewCount: Type.number(),
            videoCount: Type.number(),
            level: Type.number(),
            followerCount: Type.number(), // TWCast/Mildom specific
        }),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
    }
)

export type ChannelsProps = ExtractProps<typeof ChannelsSchema>;
export type ChannelStatsHistProps = ExtractProps<typeof ChannelStatsHistorySchema>;

export const ChannelsData = typedModel("ChannelsData", ChannelsSchema, undefined, undefined, {
    filteredFind: async function (excluded: FiltersDataConfig, included: FiltersDataConfig, project?: {}, extras?: {}[]): Promise<ChannelsProps[]> {
        let requestConfig: any[] = [];
        if (excluded["groups"].length > 0) {
            requestConfig.push({
                "group": {"$nin": excluded["groups"]}
            });
        }
        if (included["groups"].length > 0) {
            requestConfig.push({
                "group": {"$in": included["groups"]}
            });
        }
        if (excluded["channel_ids"].length > 0) {
            requestConfig.push({
                "id": {"$nin": excluded["channel_ids"]}
            });
        }
        if (included["channel_ids"].length > 0) {
            requestConfig.push({
                "id": {"$in": included["channel_ids"]}
            });
        }
        if (typeof extras !== "undefined" && extras.length > 0) {
            for (let i = 0; i < extras.length; i++) {
                requestConfig.push(extras[i]);
            }
        }
        let send: any = {};
        if (requestConfig.length > 0) {
            send["$and"] = requestConfig;
        }
        if (typeof this === "undefined") {
            return []
        }
        if (typeof project === "object" && Object.keys(project).length > 0) {
            let aggroReq = [];
            aggroReq.push({"$match": send});
            aggroReq.push({"$project": project});
            return await this.aggregate(aggroReq);
        }
        return await this.find(send);
    }
});
export const ChannelStatsHistData = typedModel("ChannelStatsHistData", ChannelStatsHistorySchema, undefined, undefined, {
    filteredFind: async function (excluded: FiltersDataConfig, included: FiltersDataConfig, project?: {}, extras?: {}[]): Promise<ChannelStatsHistProps[]> {
        let requestConfig: any[] = [];
        if (excluded["groups"].length > 0) {
            requestConfig.push({
                "group": {"$nin": excluded["groups"]}
            });
        }
        if (included["groups"].length > 0) {
            requestConfig.push({
                "group": {"$in": included["groups"]}
            });
        }
        if (excluded["channel_ids"].length > 0) {
            requestConfig.push({
                "id": {"$nin": excluded["channel_ids"]}
            });
        }
        if (included["channel_ids"].length > 0) {
            requestConfig.push({
                "id": {"$in": included["channel_ids"]}
            });
        }
        if (typeof extras !== "undefined" && extras.length > 0) {
            for (let i = 0; i < extras.length; i++) {
                requestConfig.push(extras[i]);
            }
        }
        let send: any = {};
        if (requestConfig.length > 0) {
            send["$and"] = requestConfig;
        }
        if (typeof this === "undefined") {
            return []
        }
        if (typeof project === "object" && Object.keys(project).length > 0) {
            let aggroReq = [];
            aggroReq.push({"$match": send});
            aggroReq.push({"$project": project});
            return await this.aggregate(aggroReq);
        }
        return await this.find(send);
    }
});
