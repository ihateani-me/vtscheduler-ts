export * from "./youtube";
export * from "./bilibili";
export * from "./twitcasting";
export * from "./twitch";

export interface FiltersDataConfig {
    channel_ids: string[]
    groups: string[]
}

export interface FiltersConfig {
    exclude: FiltersDataConfig
    include: FiltersDataConfig
}
