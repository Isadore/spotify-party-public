export = async function sleep(time: number) {
    return new Promise((resolve, reject) => {
        return setTimeout(resolve, time);
    });
}