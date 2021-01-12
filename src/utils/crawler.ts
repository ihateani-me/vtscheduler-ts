const delayPromise = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function resolveDelayCrawlerPromises<T>(requests: Promise<T>[], delayPerRequest: number): Promise<T>[] {
    const remapRequest = requests.map(async (prom, idx) => {
        await delayPromise(delayPerRequest * idx);
        let res = await prom;
        return res;
    })
    return remapRequest;
}
