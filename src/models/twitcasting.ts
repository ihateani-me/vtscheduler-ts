import { createSchema, Type, typedModel, ExtractProps } from "ts-mongoose";

const TwitcastingVideoSchema = createSchema(
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
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
    }
)

const TwitcastingChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        name: Type.string({required: true}),
        description: Type.string(),
        followerCount: Type.number(),
        level: Type.number(),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            followerCount: Type.number(),
            level: Type.number(),
        }),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
    }
)

export type TWCastVideoProps = ExtractProps<typeof TwitcastingVideoSchema>;
export type TWCastChannelProps = ExtractProps<typeof TwitcastingChannelSchema>;

const TwitcastingVideo = typedModel("TwitcastingVideo", TwitcastingVideoSchema, undefined, undefined, {
    findByVideo: (yt_id: string) => {
        // @ts-expect-error
        return this.find({"id": {"$eq": yt_id}});
    },
    findMulVideo: (yt_ids: string[]) => {
        // @ts-expect-error
        return this.find({"id": {"$in": yt_ids}});
    }
});
const TwitcastingChannel = typedModel("TwitcastingChannel", TwitcastingChannelSchema, undefined, undefined, {
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
    TwitcastingVideo,
    TwitcastingChannel
}