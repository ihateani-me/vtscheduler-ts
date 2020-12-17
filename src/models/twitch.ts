import { createSchema, Type, typedModel, ExtractDoc, ExtractProps } from "ts-mongoose";

const TwitchVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
        title: Type.string({required: true}),
        status: Type.string({required: true}),
        startTime: Type.number(),
        endTime: Type.number(),
        viewers: Type.number(),
        peakViewers: Type.number(),
        channel_uuid: Type.string({required: true}),
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
    }
)

const TwitchChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        user_id: Type.string({ required: true }),
        name: Type.string({required: true}),
        description: Type.string(),
        publishedAt: Type.string({required: true}),
        followerCount: Type.number(),
        viewCount: Type.number(),
        videoCount: Type.number(),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
    }
)

export type TTVVideoProps = ExtractProps<typeof TwitchVideoSchema>;
export type TTVChannelProps = ExtractProps<typeof TwitchChannelSchema>;

const TwitchVideo = typedModel("TwitchVideo", TwitchVideoSchema, undefined, undefined, {
    findByVideo: (yt_id: string) => {
        // @ts-expect-error
        return this.find({"id": {"$eq": yt_id}});
    },
    findMulVideo: (yt_ids: string[]) => {
        // @ts-expect-error
        return this.find({"id": {"$in": yt_ids}});
    }
});
const TwitchChannel = typedModel("TwitchChannel", TwitchChannelSchema, undefined, undefined, {
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
    TwitchChannel,
    TwitchVideo
}