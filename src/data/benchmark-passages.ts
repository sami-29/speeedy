export interface BenchmarkQuestion {
	q: string;
	options: string[];
	correct: number;
}

export interface BenchmarkPassage {
	id: string;
	title: string;
	text: string;
	wordCount: number;
	questions: BenchmarkQuestion[];
}

export const BENCHMARK_PASSAGES: BenchmarkPassage[] = [
	{
		id: "deep-ocean",
		title: "The Deep Ocean",
		wordCount: 311,
		text: `The deep ocean covers more than sixty percent of Earth's surface, yet until the twentieth century humans knew almost nothing about it. For most of history the sea floor was a mystery: too dark, too cold, and too deep to explore. That changed when technology allowed scientists to descend beyond the reach of sunlight.

The first systematic surveys of the deep sea began in the 1870s, when the British research vessel HMS Challenger spent four years crossing the world's oceans. The crew dropped weighted lines to measure depths and dragged nets along the bottom to collect specimens. They found that the ocean floor was not flat and featureless as many had assumed, but marked by vast mountain ranges, wide plains, and very deep trenches.

Modern ocean science uses very different tools. Sonar maps the sea floor by emitting sound pulses and measuring how long they take to return. Remotely operated vehicles, or ROVs, carry cameras and robotic arms to depths of several kilometres. These machines have revealed entire ecosystems clustered around hydrothermal vents — cracks in the ocean floor where superheated water rich in minerals escapes from within the Earth. Communities of tube worms, shrimp, and crabs thrive there without any sunlight at all, drawing energy from chemicals rather than from the sun.

The deepest point in the ocean is the Challenger Deep, located in the western Pacific at the southern end of the Mariana Trench. It reaches approximately eleven kilometres below the surface, making it deeper than Mount Everest is tall. Only a handful of crewed submersibles have ever reached the bottom. The pressure there is more than a thousand times the pressure at sea level.

Scientists think the deep ocean may hold clues about the origins of life on Earth and possibly about conditions on other worlds where liquid water exists beneath frozen surfaces.`,
		questions: [
			{
				q: "What fraction of Earth's surface is covered by the deep ocean?",
				options: ["About 30%", "About 40%", "More than 60%", "About 80%"],
				correct: 2,
			},
			{
				q: "What was the name of the British research vessel that conducted the first systematic deep-sea surveys in the 1870s?",
				options: [
					"HMS Discovery",
					"HMS Challenger",
					"HMS Endeavour",
					"HMS Beagle",
				],
				correct: 1,
			},
			{
				q: "What did early scientists discover about the ocean floor?",
				options: [
					"It was completely flat and featureless",
					"It was covered entirely in sand",
					"It had mountain ranges, plains, and deep trenches",
					"It was too deep to measure",
				],
				correct: 2,
			},
			{
				q: "How does sonar map the sea floor?",
				options: [
					"By taking photographs from satellites",
					"By sending down divers with cameras",
					"By emitting sound pulses and measuring return time",
					"By dragging weighted nets along the bottom",
				],
				correct: 2,
			},
			{
				q: "What are hydrothermal vents?",
				options: [
					"Underwater volcanoes that erupt lava",
					"Cracks where superheated mineral-rich water escapes from within the Earth",
					"Tunnels dug by deep-sea creatures",
					"Cold water springs on the ocean floor",
				],
				correct: 1,
			},
			{
				q: "How do creatures living near hydrothermal vents obtain energy?",
				options: [
					"From sunlight filtered through deep water",
					"From chemicals, not sunlight",
					"By feeding on fish that sink from above",
					"From heat radiation alone",
				],
				correct: 1,
			},
			{
				q: "Where is the Challenger Deep located?",
				options: [
					"In the Atlantic Ocean near the Azores",
					"In the Indian Ocean south of Sri Lanka",
					"In the western Pacific at the southern end of the Mariana Trench",
					"In the Arctic Ocean near Greenland",
				],
				correct: 2,
			},
			{
				q: "How deep is the Challenger Deep approximately?",
				options: [
					"About 5 kilometres",
					"About 8 kilometres",
					"About 11 kilometres",
					"About 15 kilometres",
				],
				correct: 2,
			},
			{
				q: "How does the pressure at the Challenger Deep compare to sea-level pressure?",
				options: [
					"About 10 times greater",
					"About 100 times greater",
					"More than 1,000 times greater",
					"About 500 times greater",
				],
				correct: 2,
			},
			{
				q: "What do scientists think the deep ocean might provide clues about?",
				options: [
					"The age of the universe",
					"The origins of life on Earth and conditions on other worlds with liquid water",
					"The causes of earthquakes and volcanic eruptions only",
					"The composition of Earth's atmosphere millions of years ago",
				],
				correct: 1,
			},
		],
	},
	{
		id: "sleep-science",
		title: "The Science of Sleep",
		wordCount: 308,
		text: `Sleep occupies roughly a third of a human life, yet for centuries it was thought to be little more than a passive state of rest. Modern neuroscience has overturned that view. Sleep is now understood as a period of intense biological activity, essential for memory, immune function, emotional regulation, and the clearance of metabolic waste from the brain.

During sleep, the brain cycles through several distinct stages. The earliest stages show slow, synchronised electrical activity as the body relaxes and temperature drops. After about ninety minutes, the brain enters REM, or rapid eye movement sleep, when brain activity resembles wakefulness. Most vivid dreaming happens in REM. A typical night has four to six of these cycles, with REM periods growing longer toward morning.

A major discovery of recent decades is a system called the glymphatic network. During sleep, channels around the brain's blood vessels widen, allowing cerebrospinal fluid to flush through brain tissue and clear away proteins that build up during waking hours. One of these proteins is amyloid-beta, which is linked to Alzheimer's disease when it accumulates. Poor sleep over many years may increase the risk of neurodegenerative conditions.

Memory consolidation also happens in sleep. While people are awake, the hippocampus records new experiences in a fast but temporary form. During deep sleep, those memories are replayed and transferred to the cortex for long-term storage. Students who sleep well after studying remember more than those who stay awake.

Sleep needs vary with age. Newborns require up to seventeen hours, adolescents around nine, and most adults between seven and nine hours per night. Chronic sleep restriction, even by just one or two hours a night, accumulates into what researchers call a sleep debt that impairs cognition and mood significantly.`,
		questions: [
			{
				q: "How did scientists historically view sleep?",
				options: [
					"As a period of intense brain activity",
					"As a passive state of rest",
					"As essential for memory only",
					"As a state similar to being awake",
				],
				correct: 1,
			},
			{
				q: "What is REM sleep?",
				options: [
					"The earliest stage with slow brain activity",
					"A phase where the body temperature rises rapidly",
					"A phase of brain activity resembling wakefulness where most vivid dreaming occurs",
					"A stage unique to children",
				],
				correct: 2,
			},
			{
				q: "How long does a typical sleep cycle last before the first REM phase?",
				options: [
					"About 30 minutes",
					"About 60 minutes",
					"About 90 minutes",
					"About 120 minutes",
				],
				correct: 2,
			},
			{
				q: "What is the glymphatic network?",
				options: [
					"A system of neurons responsible for dreaming",
					"Channels around brain blood vessels that flush away metabolic waste during sleep",
					"The part of the brain that controls REM cycles",
					"A hormone system that regulates sleep timing",
				],
				correct: 1,
			},
			{
				q: "Which protein is associated with Alzheimer's disease when it builds up?",
				options: ["Serotonin", "Dopamine", "Amyloid-beta", "Cortisol"],
				correct: 2,
			},
			{
				q: "Where does the brain initially store new experiences during wakefulness?",
				options: [
					"The cortex",
					"The cerebellum",
					"The hippocampus",
					"The amygdala",
				],
				correct: 2,
			},
			{
				q: "What happens to memories during deep sleep?",
				options: [
					"They are erased to free up space",
					"They are replayed and transferred from the hippocampus to the cortex",
					"They are locked in the hippocampus permanently",
					"They are converted to dreams",
				],
				correct: 1,
			},
			{
				q: "How many sleep cycles does a typical night contain?",
				options: ["One to two", "Two to three", "Four to six", "Eight to ten"],
				correct: 2,
			},
			{
				q: "How many hours of sleep do most adults need per night?",
				options: ["5–6 hours", "6–7 hours", "7–9 hours", "10–12 hours"],
				correct: 2,
			},
			{
				q: "What did research show about students who sleep well after studying?",
				options: [
					"They perform worse on tests due to reduced alertness",
					"They remember more than those who stay awake",
					"They experience more vivid dreams about the material",
					"Sleep has no significant effect on memory retention",
				],
				correct: 1,
			},
		],
	},
	{
		id: "urban-forests",
		title: "Urban Forests",
		wordCount: 302,
		text: `Cities are often seen as hostile to nature: expanses of concrete, glass, and steel with little room for living things. Research shows that trees in urban settings provide such clear benefits that many planners now treat them as essential infrastructure, on a par with roads and water pipes.

The most immediate effect of urban trees is thermal. A single mature tree can transpire hundreds of litres of water per day, cooling the surrounding air through evaporation in much the same way that sweating cools the human body. In dense cities, where asphalt and dark rooftops absorb and re-radiate heat, this effect can reduce local temperatures by several degrees. As global temperatures rise, planners in many cities now treat tree canopy coverage as a formal target, measuring it alongside indicators like air quality and flood risk.

Trees also intercept rainfall. Their leaves and branches slow the descent of water, giving soil time to absorb it rather than allowing it to run off directly into drains. A mature oak can intercept tens of thousands of litres of rainfall per year, reducing the burden on sewer systems during heavy storms — a problem that becomes more acute as precipitation events grow more intense with climate change.

The psychological effects are less obvious but have been studied. Work using satellite imagery and self-reported wellbeing data has found consistent links between street tree density and lower rates of depression, anxiety, and stress. Proximity to greenery appears to restore attention and reduce physiological markers of tension, even in brief exposures.

Despite these benefits, urban trees are expensive to plant and maintain, and many cities in lower-income regions lack the budgets to establish meaningful canopy cover. Researchers argue that closing this gap is both an environmental and a public health equity issue.`,
		questions: [
			{
				q: "How do urban trees help cool cities?",
				options: [
					"By blocking sunlight with their canopies alone",
					"By transpiring water which cools the surrounding air through evaporation",
					"By absorbing heat into their trunks",
					"By creating wind tunnels between buildings",
				],
				correct: 1,
			},
			{
				q: "What happens to heat in dense cities with lots of asphalt?",
				options: [
					"It is reflected back into space",
					"It is absorbed by the ground and dissipates overnight",
					"It is absorbed and re-radiated by asphalt and dark rooftops",
					"It has no effect on local temperature",
				],
				correct: 2,
			},
			{
				q: "How do urban trees help manage rainfall?",
				options: [
					"They pump water underground into aquifers",
					"Their leaves and branches slow water's descent, giving soil time to absorb it",
					"They channel rainwater directly into rivers",
					"They have no significant effect on water management",
				],
				correct: 1,
			},
			{
				q: "Approximately how much rainfall can a mature oak intercept per year?",
				options: [
					"Hundreds of litres",
					"Thousands of litres",
					"Tens of thousands of litres",
					"Hundreds of thousands of litres",
				],
				correct: 2,
			},
			{
				q: "What psychological benefits have been linked to street trees?",
				options: [
					"Improved mathematical performance",
					"Lower rates of depression, anxiety, and stress",
					"Better sleep quality only",
					"Increased social aggression",
				],
				correct: 1,
			},
			{
				q: "What data did researchers use to study trees and wellbeing?",
				options: [
					"Hospital records and pollution sensors",
					"Satellite imagery and self-reported wellbeing data",
					"Soil samples and air quality monitors",
					"Traffic data and crime statistics",
				],
				correct: 1,
			},
			{
				q: "How are urban trees now being regarded by city planners?",
				options: [
					"As decorative features with limited practical value",
					"As essential infrastructure on a par with roads and water pipes",
					"As an obstacle to urban development",
					"As a luxury only wealthy cities can afford",
				],
				correct: 1,
			},
			{
				q: "What makes rainfall events worse with climate change, according to the passage?",
				options: [
					"Cities get more snow instead of rain",
					"Drainage systems are being removed",
					"Precipitation events grow more intense",
					"Soil becomes permanently saturated",
				],
				correct: 2,
			},
			{
				q: "What is described as a barrier to urban tree planting in some regions?",
				options: [
					"Lack of suitable tree species",
					"Opposition from residents",
					"Limited budgets in lower-income cities",
					"Soil that cannot support large trees",
				],
				correct: 2,
			},
			{
				q: "What does the passage argue about the gap in urban tree coverage?",
				options: [
					"It is mainly an aesthetic problem",
					"It is not worth addressing given the cost",
					"It is an issue of public health equity, not just environment",
					"It only matters in tropical climates",
				],
				correct: 2,
			},
		],
	},
	{
		id: "invention-writing",
		title: "The Invention of Writing",
		wordCount: 305,
		text: `Writing is so central to modern life that it is easy to forget how recently it was invented. For the vast majority of human history, knowledge was transmitted orally — through story, song, and memory. The earliest writing systems emerged only around five thousand years ago, and their invention appears to have been driven not by a desire to record literature or preserve history, but by the mundane demands of trade and administration.

The oldest known writing comes from ancient Mesopotamia, the region between the Tigris and Euphrates rivers in what is now Iraq. Archaeologists have excavated clay tablets inscribed with small pictograms representing goods and numbers. These early records were essentially receipts — lists of grain deliveries, livestock counts, and temple revenues. The system that produced them, called cuneiform, evolved over several centuries from simple pictures into abstract wedge-shaped marks pressed into wet clay with a reed stylus.

A similar story unfolded in ancient Egypt, where hieroglyphics developed as an independent writing system around the same period. Egyptian writing combined pictorial symbols representing objects with phonetic signs representing sounds, allowing scribes to transcribe names and spoken language more precisely. A third independent writing system emerged in China, and possibly a fourth in Mesoamerica, suggesting that the invention of writing, while rare, is something that human societies under sufficient organisational pressure tend to discover.

The spread of writing transformed societies. It allowed laws to be codified and applied consistently, contracts to be enforced across time and distance, and knowledge to accumulate beyond what any single memory could hold. Literate civilisations could coordinate larger populations, sustain more complex institutions, and preserve what they learned across generations.

Yet writing also created new inequalities. Literacy required training and access to materials, which meant that for most of human history, only a small elite could read and write.`,
		questions: [
			{
				q: "What primarily drove the invention of writing, according to the passage?",
				options: [
					"A desire to record poetry and literature",
					"Religious ceremonies requiring sacred texts",
					"Trade and administrative demands",
					"The wish to preserve historical events",
				],
				correct: 2,
			},
			{
				q: "Where did the oldest known writing originate?",
				options: [
					"Ancient Egypt",
					"Ancient China",
					"Ancient Mesopotamia",
					"Ancient Mesoamerica",
				],
				correct: 2,
			},
			{
				q: "What were the earliest clay tablets mainly used to record?",
				options: [
					"Military strategies and battle plans",
					"Religious texts and prayers",
					"Receipts like grain deliveries and livestock counts",
					"Poetry and folk songs",
				],
				correct: 2,
			},
			{
				q: "What tool was used to press cuneiform marks into clay?",
				options: [
					"A bone stylus",
					"A reed stylus",
					"A metal engraving tool",
					"A wooden stamp",
				],
				correct: 1,
			},
			{
				q: "How did Egyptian hieroglyphics differ from early Mesopotamian cuneiform?",
				options: [
					"Hieroglyphics used only pictorial symbols with no phonetic component",
					"Hieroglyphics combined pictorial symbols with phonetic signs representing sounds",
					"Hieroglyphics were carved in stone only, never written",
					"Hieroglyphics developed much later than cuneiform",
				],
				correct: 1,
			},
			{
				q: "How many fully independent writing systems does the passage mention?",
				options: [
					"Two",
					"Three",
					"At least three, possibly four",
					"Five or more",
				],
				correct: 2,
			},
			{
				q: "What does the emergence of writing in multiple cultures suggest?",
				options: [
					"Writing was invented once and spread through trade",
					"Writing is something societies under sufficient organisational pressure tend to discover",
					"Writing only developed where there was contact between civilisations",
					"Writing was always invented by religious leaders",
				],
				correct: 1,
			},
			{
				q: "Which of the following was a benefit of writing mentioned in the passage?",
				options: [
					"It eliminated the need for oral tradition",
					"It made all people equally literate",
					"It allowed laws to be codified and applied consistently",
					"It reduced the complexity of institutions",
				],
				correct: 2,
			},
			{
				q: "What inequality did writing create?",
				options: [
					"Wealthy traders could write faster than farmers",
					"Only men were allowed to become scribes",
					"Only a small elite had access to literacy",
					"Written laws favoured one region over another",
				],
				correct: 2,
			},
			{
				q: "Approximately how long ago did the earliest writing systems emerge?",
				options: [
					"About 1,000 years ago",
					"About 3,000 years ago",
					"About 5,000 years ago",
					"About 10,000 years ago",
				],
				correct: 2,
			},
		],
	},
	{
		id: "microbiome",
		title: "The Human Microbiome",
		wordCount: 299,
		text: `The human body contains trillions of microorganisms (bacteria, fungi, viruses, and other microscopic life) that collectively form the microbiome. These are not passive hitchhikers; they are deeply integrated into human physiology. Research over the past two decades has shown that the microbiome affects digestion, immune function, and even mental health, and has changed how scientists think about the body.

Most of the body's microorganisms live in the gut, particularly in the large intestine. Here, communities of bacteria ferment dietary fibre that human digestive enzymes cannot break down, producing short-chain fatty acids that nourish the cells lining the intestine. These same bacteria synthesise vitamins, including certain B vitamins and vitamin K, that the body cannot make on its own. Disrupting the gut microbiome — through illness, poor diet, or antibiotic use — has been associated with conditions ranging from inflammatory bowel disease to metabolic disorders.

The link between the gut microbiome and the brain has received a lot of research attention. A pathway called the gut-brain axis connects the intestinal nervous system to the central nervous system via the vagus nerve. Studies in animals and humans have found that changes in gut bacteria can influence mood, anxiety, and behaviour. Germ-free mice, raised without any microbiome, show elevated stress responses and abnormal social behaviour that can be partly reversed by reintroducing specific bacterial strains.

The composition of an individual's microbiome is shaped by diet, geography, early-life exposures, and genetics. Babies born vaginally acquire their initial microbiome from their mother during birth, while those delivered by caesarean section have a different early microbial profile. Breastfeeding further shapes the infant gut, introducing specialised bacteria that help digest milk sugars.

Understanding the microbiome is leading to new medical options, including probiotics, faecal transplants, and personalised diet interventions.`,
		questions: [
			{
				q: "Where do most of the body's microorganisms live?",
				options: [
					"The skin surface",
					"The lungs",
					"The large intestine",
					"The bloodstream",
				],
				correct: 2,
			},
			{
				q: "What do gut bacteria produce by fermenting dietary fibre?",
				options: [
					"Simple sugars and glucose",
					"Short-chain fatty acids that nourish intestinal cells",
					"Proteins used by the immune system",
					"Bile acids needed for fat digestion",
				],
				correct: 1,
			},
			{
				q: "Which vitamins do gut bacteria help synthesise?",
				options: [
					"Vitamins A and C",
					"Vitamins D and E",
					"Certain B vitamins and vitamin K",
					"Vitamins C and D only",
				],
				correct: 2,
			},
			{
				q: "What is the gut-brain axis?",
				options: [
					"A region of the brain that controls digestion",
					"A pathway connecting the intestinal nervous system to the brain via the vagus nerve",
					"A type of gut bacteria that produces neurotransmitters",
					"A surgical procedure linking gut and brain signals",
				],
				correct: 1,
			},
			{
				q: "What behaviour did germ-free mice (without a microbiome) show?",
				options: [
					"They were more social and curious than normal mice",
					"They showed no differences from normal mice",
					"They showed elevated stress responses and abnormal social behaviour",
					"They were healthier and lived longer",
				],
				correct: 2,
			},
			{
				q: "How can the behaviour of germ-free mice be partially reversed?",
				options: [
					"By giving them antibiotic treatments",
					"By reintroducing specific bacterial strains",
					"By feeding them a high-fibre diet",
					"By stimulating the vagus nerve electrically",
				],
				correct: 1,
			},
			{
				q: "How do babies born vaginally acquire their initial microbiome?",
				options: [
					"From the hospital environment after birth",
					"From breast milk only",
					"From their mother during birth",
					"From the air they first breathe",
				],
				correct: 2,
			},
			{
				q: "Which of the following was NOT listed as a factor shaping the microbiome?",
				options: ["Diet", "Geography", "Blood type", "Early-life exposures"],
				correct: 2,
			},
			{
				q: "What is one medical application mentioned that uses microbiome knowledge?",
				options: [
					"Gene therapy targeting gut DNA",
					"Faecal transplants",
					"Surgical removal of harmful bacteria",
					"Hormone replacement therapy",
				],
				correct: 1,
			},
			{
				q: "What happens to the microbiome when antibiotics are used?",
				options: [
					"The microbiome strengthens and diversifies",
					"Antibiotics only affect harmful bacteria, leaving beneficial ones untouched",
					"Disruption of the microbiome is associated with conditions like inflammatory bowel disease",
					"The gut bacteria multiply rapidly to compensate",
				],
				correct: 2,
			},
		],
	},
];

export function pickPassage(excludeId?: string): BenchmarkPassage {
	const available = excludeId
		? BENCHMARK_PASSAGES.filter((p) => p.id !== excludeId)
		: BENCHMARK_PASSAGES;
	return available[Math.floor(Math.random() * available.length)];
}
