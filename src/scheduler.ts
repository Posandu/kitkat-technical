import { runChecks } from "./monitor";
import { getConfig, onConfigChange } from "./routes/config";

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let runRequested = false;

function clearTimer() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
}

async function tick() {
	timer = null;
	if (running) {
		runRequested = true;
		return;
	}
	running = true;
	try {
		await runChecks();
	} catch (err) {
		console.error("[monitor] check failed:", err);
	} finally {
		running = false;
		if (runRequested) {
			runRequested = false;
			void tick();
			return;
		}
		scheduleNextCheck();
	}
}

export function scheduleNextCheck(): void {
	clearTimer();
	const { checkIntervalSeconds } = getConfig();
	const ms = Math.max(1, checkIntervalSeconds) * 1000;
	timer = setTimeout(tick, ms);
}

export function rescheduleNow(): void {
	scheduleNextCheck();
}

export function startMonitor(): void {
	onConfigChange(() => {
		scheduleNextCheck();
	});
	void tick();
}
