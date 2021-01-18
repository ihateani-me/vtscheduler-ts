import { createSchema, Type, typedModel, ExtractProps } from "ts-mongoose";

const MildomVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
        title: Type.string({required: true}),
        status: Type.string({required: true}),
        timedata: Type.object({required: true}).of({
            startTime: Type.number(),
            endTime: Type.number(),
            duration: Type.number(),
            publishedAt: Type.string(),
        }),
        viewers: Type.number(),
        peakViewers: Type.number(),
        averageViewers: Type.number(),
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
    }
)

const MildomChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        name: Type.string({required: true}),
        en_name: Type.string(),
        description: Type.string(),
        followerCount: Type.number(),
        videoCount: Type.number(),
        level: Type.number(),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            followerCount: Type.number(),
            videoCount: Type.number(),
            level: Type.number(),
        }),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
    }
)

export type MildomVideoProps = ExtractProps<typeof MildomVideoSchema>;
export type MildomChannelProps = ExtractProps<typeof MildomChannelSchema>;

const MildomVideo = typedModel("MildomVideo", MildomVideoSchema, undefined, undefined, {
    findByVideo: (yt_id: string) => {
        // @ts-expect-error
        return this.find({"id": {"$eq": yt_id}});
    },
    findMulVideo: (yt_ids: string[]) => {
        // @ts-expect-error
        return this.find({"id": {"$in": yt_ids}});
    }
});
const MildomChannel = typedModel("MildomChannel", MildomChannelSchema, undefined, undefined, {
    findByChannel: (yt_id: string) => {
        // @ts-expect-error
        return this.find({"id": {"$eq": yt_id}});
    },
    findMulChannel: (yt_ids: string[]) => {
        // @ts-expect-error
        return this.find({"id": {"$in": yt_ids}});
    }
});

export {
    MildomVideo,
    MildomChannel
}