import { createSchema, Type, typedModel, ExtractProps } from "ts-mongoose";

const ViewersDataSchema = createSchema({
    id: Type.string({required: true}),
    viewersData: Type.array({required: true}).of({
        timestamp: Type.number({required: true}),
        viewers: Type.number(),
    }),
    group: Type.string({required: true}),
    platform: Type.string({required: true}),
})

export type ViewersProps = ExtractProps<typeof ViewersDataSchema>
export const ViewersData = typedModel("ViewersData", ViewersDataSchema);
