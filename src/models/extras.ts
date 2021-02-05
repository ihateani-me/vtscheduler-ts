export interface FiltersDataConfig {
    channel_ids: string[]
    groups: string[]
}

export interface FiltersConfig {
    exclude: FiltersDataConfig
    include: FiltersDataConfig
}

export interface HistoryMap {
    id: string
    history: any
    mod: "insert" | "update"
    group: string
}

export const PlatformData = ["youtube", "bilibili", "twitch", "twitcasting", "mildom"] as const;
export const LiveStatus = ["live", "upcoming", "past", "video"] as const;