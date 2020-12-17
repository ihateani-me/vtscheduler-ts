const delayPromise = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function resolveDelayCrawlerPromises(requests: Promise<any>[], delayPerRequest: number) {
    const remapRequest = requests.map(async (prom, idx) => {
        await delayPromise(delayPerRequest * idx);
        let res = await prom;
        return res;
    })
    return remapRequest;
}
