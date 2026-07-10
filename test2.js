function isDue(scheduled_at) {
    const now = new Date();
    const offset = 8 * 60 * 60 * 1000;
    const localNow = new Date(now.getTime() + offset);
    
    const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][localNow.getUTCDay()];
    const currentHourStr = localNow.getUTCHours().toString().padStart(2, "0");
    const currentMinStr = localNow.getUTCMinutes().toString().padStart(2, "0");
    const currentTimeStr = `${currentHourStr}:${currentMinStr}`;

    if (!scheduled_at || scheduled_at === "immediate") return true;

    if (scheduled_at.length === 5 && scheduled_at.includes(":")) {
        return currentTimeStr >= scheduled_at;
    }

    if (scheduled_at.includes("T")) {
        const [day, time] = scheduled_at.split("T");
        if (dayOfWeek === day && currentTimeStr >= time) return true;
        return false;
    }

    return false; // Or handle ISO strings if any
}

console.log(isDue("immediate"));
