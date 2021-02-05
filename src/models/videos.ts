import { createSchema, Type, typedModel, ExtractProps } from "ts-mongoose";
import { FiltersDataConfig, LiveStatus, PlatformData } from "./extras";

const VideosSchema = createSchema(
    {
        id: Type.string({ required: true }),
        room_id: Type.string(), // B2 Specific
        title: Type.string({required: true}),
        status: Type.string({required: true, enum: LiveStatus}),
        timedata: Type.object({required: true}).of({
            scheduledStartTime: Type.number(),
            startTime: Type.number(),
            endTime: Type.number(),
            lateTime: Type.number(),
            duration: Type.number(),
            publishedAt: Type.string(),
        }),
        viewers: Type.number(),
        peakViewers: Type.number(),
        averageViewers: Type.number(),
        channel_uuid: Type.string(), // Twitch specific
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true, enum: PlatformData}),
        is_missing: Type.boolean(),
        is_premiere: Type.boolean(),
        is_member: Type.boolean(),
    }
)

const ViewersDataSchema = createSchema({
    id: Type.string({required: true}),
    viewersData: Type.array({required: true}).of({
        timestamp: Type.number({required: true}),
        viewers: Type.number(),
    }),
    group: Type.string({required: true}),
    platform: Type.string({required: true, enum: PlatformData}),
})

export type ViewersProps = ExtractProps<typeof ViewersDataSchema>
export type VideoProps = ExtractProps<typeof VideosSchema>
export const ViewersData = typedModel("ViewersData", ViewersDataSchema);
export const VideosData = typedModel("VideosData", VideosSchema, undefined, undefined, {
    filteredFind: async function (excluded: FiltersDataConfig, included: FiltersDataConfig, project?: {}, extras?: {}[]): Promise<VideoProps[]> {
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

