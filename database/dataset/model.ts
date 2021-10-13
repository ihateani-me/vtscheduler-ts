export interface DatasetModel {
    id: string
    name: string
    vliver: VTuberModel[]
}

export interface VTuberModel {
    id: string
    name: string
    youtube?: string
    bilibili?: string
    twitch?: string
    twitcasting?: string
    mildom?: string
    twitter?: string
}