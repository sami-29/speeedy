import { describe, expect, it } from "vitest";
import { detectLanguage, parse, parseText } from "../src/index";
import { expectSuccess, utf8 } from "./helpers";

const samples: Record<string, string> = {
	en: "The old man walked slowly along the road, and he thought that the weather would change before they reached the village.",
	es: "El hombre caminaba despacio por el camino y pensaba que el tiempo cambiaría antes de que llegaran a la aldea con los niños.",
	fr: "Le vieil homme marchait lentement sur la route et il pensait que le temps allait changer avant qu'ils arrivent dans le village.",
	de: "Der alte Mann ging langsam die Straße entlang und dachte, dass sich das Wetter ändern würde, bevor sie das Dorf erreichten.",
	it: "Il vecchio camminava lentamente lungo la strada e pensava che il tempo sarebbe cambiato prima che arrivassero al villaggio con i bambini.",
	pt: "O velho caminhava devagar pela estrada e pensava que o tempo ia mudar antes que eles chegassem à aldeia com as crianças.",
	nl: "De oude man liep langzaam over de weg en hij dacht dat het weer zou veranderen voordat ze het dorp met de kinderen bereikten.",
	tr: "Yaşlı adam yolda yavaşça yürüyordu ve hava değişmeden önce köye varabileceklerini düşünüyordu, çünkü akşam olmak üzereydi.",
	pl: "Starzec szedł powoli drogą i myślał, że pogoda zmieni się, zanim dotrą do wsi, ponieważ wieczór był już blisko.",
	cs: "Starý muž šel pomalu po cestě a myslel si, že se počasí změní dříve, než dojdou do vesnice, protože se blížil večer.",
	ru: "Старик медленно шёл по дороге и думал о том, что погода изменится до того, как они дойдут до деревни, потому что вечер был близко.",
	uk: "Старий повільно йшов дорогою і думав про те, що погода зміниться, перш ніж вони дійдуть до села, тому що вечір був близько, і він їх не бачив.",
	bg: "Старецът вървеше бавно по пътя и мислеше, че времето ще се промени, преди да стигнат до селото, защото вечерта наближаваше.",
	ar: "كان الرجل العجوز يمشي ببطء على الطريق وكان يعتقد أن الطقس سيتغير قبل أن يصلوا إلى القرية لأن المساء كان قريبا.",
	fa: "پیرمرد آهسته در جاده قدم می‌زد و فکر می‌کرد که هوا پیش از رسیدن به روستا تغییر خواهد کرد، چون شب نزدیک بود و گرگ‌ها می‌آمدند.",
	he: "הזקן הלך לאט לאורך הדרך וחשב שמזג האוויר ישתנה לפני שיגיעו לכפר, כי הערב היה קרוב מאוד והם היו עייפים.",
	el: "Ο γέρος περπατούσε αργά στον δρόμο και σκεφτόταν ότι ο καιρός θα άλλαζε πριν φτάσουν στο χωριό, επειδή το βράδυ πλησίαζε.",
	zh: "老人沿着道路慢慢地走着，他想天气在他们到达村庄之前会发生变化，因为傍晚就快要到了。",
	ja: "老人はゆっくりと道を歩きながら、村に着く前に天気が変わるだろうと考えていました。夕方が近づいていたからです。",
	ko: "노인은 천천히 길을 걸으며 마을에 도착하기 전에 날씨가 바뀔 것이라고 생각했다. 저녁이 가까워지고 있었기 때문이다.",
	th: "ชายชราเดินไปตามถนนอย่างช้าๆ และคิดว่าอากาศจะเปลี่ยนก่อนที่พวกเขาจะไปถึงหมู่บ้าน",
	hi: "बूढ़ा आदमी सड़क पर धीरे धीरे चल रहा था और सोच रहा था कि गांव पहुंचने से पहले मौसम बदल जाएगा।",
};

describe("detectLanguage", () => {
	it.each(Object.entries(samples))("recognises %s", (code, text) => {
		expect(detectLanguage(text).code).toBe(code);
	});

	it("names how it decided", () => {
		expect(detectLanguage(samples.ja ?? "").source).toBe("script");
		expect(detectLanguage(samples.en ?? "").source).toBe("stopwords");
	});

	it("prefers declared metadata over the text", () => {
		expect(detectLanguage(samples.en ?? "", "de")).toMatchObject({
			code: "de",
			source: "metadata",
		});
		expect(detectLanguage(samples.en ?? "", "pt-BR")).toMatchObject({
			code: "pt",
			source: "metadata",
		});
	});

	it("ignores declared languages that are not valid tags", () => {
		for (const bad of [
			"",
			"   ",
			"english please",
			"xx-",
			"123",
			"a".repeat(500),
			"und",
			"zz-ZZ-garbage-123456789",
		]) {
			expect(detectLanguage(samples.fr ?? "", bad).code, bad).toBe("fr");
		}
	});

	it("answers und, never a guess, for text with no usable signal", () => {
		for (const text of [
			"",
			"   ",
			"12345 67890",
			"!!! ... ???",
			"ok",
			"xqzv wkpt",
		]) {
			expect(detectLanguage(text), text).toMatchObject({
				code: "und",
				source: "unknown",
			});
		}
	});

	it("tells Chinese from Japanese by kana", () => {
		expect(detectLanguage("日本語の文章です。").code).toBe("ja");
		expect(detectLanguage("这是一个中文句子。").code).toBe("zh");
	});

	it("only looks at a bounded sample, so a huge input stays fast", () => {
		const started = Date.now();
		const huge = `${samples.tr}\n`.repeat(200_000);
		expect(detectLanguage(huge).code).toBe("tr");
		expect(Date.now() - started).toBeLessThan(1000);
	});
});

describe("language through parse", () => {
	it("returns the detected language with the Document", async () => {
		const result = expectSuccess(await parse(utf8(samples.ru ?? ""), "a.txt"));
		expect(result.language).toMatchObject({ code: "ru", source: "script" });
	});

	it("uses a reader override from hints and reports it as a hint", async () => {
		const result = expectSuccess(
			await parse(utf8(samples.en ?? ""), "a.txt", { language: "fr" }),
		);
		expect(result.language).toMatchObject({ code: "fr", source: "hint" });
		const pasted = expectSuccess(
			await parseText(samples.en ?? "", { language: "tr-TR" }),
		);
		expect(pasted.language).toMatchObject({ code: "tr", source: "hint" });
	});

	it("ignores an invalid override", async () => {
		const result = expectSuccess(
			await parse(utf8(samples.es ?? ""), "a.txt", { language: "not a tag!" }),
		);
		expect(result.language.code).toBe("es");
	});
});
