import { createSchema, Type, typedModel, ExtractProps } from "ts-mongoose";

const LiveStatus = ["live", "upcoming", "past", "video"] as const;

const YoutubeVideoSchema = createSchema(
    {
        id: Type.string({ required: true }),
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
        channel_id: Type.string({required: true}),
        thumbnail: Type.string({required: true}),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
        is_missing: Type.boolean(),
        is_premiere: Type.boolean(),
    }
)

const YoutubeChannelSchema = createSchema(
    {
        id: Type.string({ required: true }),
        name: Type.string({required: true}),
        description: Type.string(),
        publishedAt: Type.string({required: true}),
        subscriberCount: Type.number(),
        viewCount: Type.number(),
        videoCount: Type.number(),
        thumbnail: Type.string({required: true}),
        history: Type.array().of({
            timestamp: Type.number({required: true}),
            subscriberCount: Type.number(),
            viewCount: Type.number(),
            videoCount: Type.number()
        }),
        group: Type.string({required: true}),
        platform: Type.string({required: true}),
    }
)

export type YTVideoProps = ExtractProps<typeof YoutubeVideoSchema>;
export type YTChannelProps = ExtractProps<typeof YoutubeChannelSchema>;

const YoutubeVideo = typedModel("YoutubeVideo", YoutubeVideoSchema, undefined, undefined, {
    findByVideo: (yt_id: string) => {
        // @ts-expect-error
        return this.find({"id": {"$eq": yt_id}});
    },
    findMulVideo: (yt_ids: string[]) => {
        // @ts-expect-error
        return this.find({"id": {"$in": yt_ids}});
    }
});
const YoutubeChannel = typedModel("YoutubeChannel", YoutubeChannelSchema, undefined, undefined, {
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
    YoutubeVideo,
    YoutubeChannel
}