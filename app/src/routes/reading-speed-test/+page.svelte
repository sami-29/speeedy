<script lang="ts">
import { m } from "#lib/paraglide/messages.js";
import { localizeHref } from "#lib/paraglide/runtime.js";
import SearchSection from "#lib/SearchSection.svelte";
import Seo from "#lib/Seo.svelte";
import BenchmarkTest from "#lib/training/BenchmarkTest.svelte";
</script>

<Seo title={m.benchmark_title()} description={m.benchmark_description()} path="/reading-speed-test" />

<section class="poster pt-s-6 pb-s-5">
	<h1 class="headline poster-head enter">{m.benchmark_headline()}</h1>
	<div>
		<p class="lead max-w-[34ch]">{m.benchmark_lead()}</p>
		<div class="mt-s-4">
			<BenchmarkTest />
		</div>
	</div>
</section>

<SearchSection title={m.benchmark_how_title()}>
	<p>{m.benchmark_how_read()}</p>
	<p>{m.benchmark_how_quiz()}</p>
	<p>{m.benchmark_how_score()}</p>
</SearchSection>
<SearchSection title={m.benchmark_mean_title()}>
	<p>{m.benchmark_mean_average()}</p>
	<p>
		<a class="underline" href={localizeHref("/learn/average-reading-speed")}>{m.benchmark_mean_link()}</a>
	</p>
</SearchSection>
<SearchSection title={m.benchmark_rough_title()}>
	<p>{m.benchmark_rough_text()}</p>
</SearchSection>
