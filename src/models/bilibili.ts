import { createSchema, Type, typedModel, ExtractProps } from "ts-mongoose";

const BilibiliVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
        room_id: Type.number({required: true}),
        title: Type.string({required: true}),
        startTime: Type.number(),
        endTime: Type.number(),
        viewers: Type.number(),
        peakViewers: Type.number(),
        status: Type.string({required: true}),
        channel_id: Type.string({required: true}),
        thumbnail: Type.string(),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
    }
)

const BilibiliChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        room_id: Type.string({ required: true }),
        name: Type.string({required: true}),
        description: Type.string(),
        subscriberCount: Type.number(),
        viewCount: Type.number(),
        videoCount: Type.number(),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        live: Type.boolean(),
        platform: Type.string({required: true}),
    }
)

export type B2VideoProps = ExtractProps<typeof BilibiliVideoSchema>;
export type B2ChannelProps = ExtractProps<typeof BilibiliChannelSchema>;

const BilibiliVideo = typedModel("BilibiliVideo", BilibiliVideoSchema, undefined, undefined, {
    findByVideo: (yt_id: string) => {
        // @ts-expect-error
        return this.find({"id": {"$eq": yt_id}});
    },
    findMulVideo: (yt_ids: string[]) => {
        // @ts-expect-error
        return this.find({"id": {"$in": yt_ids}});
    }
});
const BilibiliChannel = typedModel("BilibiliChannel", BilibiliChannelSchema, undefined, undefined, {
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
    BilibiliVideo,
    BilibiliChannel
}