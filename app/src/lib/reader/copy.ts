import type { BackUnit } from "@speeedy/engine";
import { m } from "#lib/paraglide/messages.js";
import type { ShortcutId } from "./shortcuts.ts";
import { WPM_MAX } from "./wpm.ts";
import type { SpeedZone, SpeedZoneId } from "./zones.ts";

/** The wording for Speed Zones and shortcuts, looked up by id. */
export const zoneName = (id: SpeedZoneId): string =>
	({ study: m.zone_study, read: m.zone_read, skim: m.zone_skim })[id]();

export const zoneNote = (id: SpeedZoneId): string =>
	({
		study: m.zone_study_note,
		read: m.zone_read_note,
		skim: m.zone_skim_note,
	})[id]();

/** "100 to 199", or "350 and up" for the top zone. */
export const zoneRange = (zone: SpeedZone): string =>
	zone.max >= WPM_MAX
		? m.zone_range_open({ min: zone.min })
		: m.zone_range({ min: zone.min, max: zone.max });

export const shortcutName = (id: ShortcutId): string =>
	({
		toggle: m.shortcut_toggle,
		back: m.shortcut_back,
		back_paragraph: m.shortcut_back_paragraph,
		back_chapter: m.shortcut_back_chapter,
		speed: m.shortcut_speed,
		speed_big: m.shortcut_speed_big,
		mode: m.shortcut_mode,
		help: m.shortcut_help,
	})[id]();

const MODE_NAMES: Record<string, () => string> = {
	rsvp: m.mode_rsvp,
	pacer: m.mode_pacer,
};

export const modeName = (id: string): string => MODE_NAMES[id]?.() ?? id;

/** The short word on a rewind button; the full "Back one ..." wording is its accessible name. */
export const rewindName = (unit: BackUnit): string =>
	({
		sentence: m.reader_rewind_sentence,
		paragraph: m.reader_rewind_paragraph,
		chapter: m.reader_rewind_chapter,
	})[unit]();
