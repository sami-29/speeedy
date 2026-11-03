<script lang="ts">
import Article from "#lib/learn/Article.svelte";
import { getArticle } from "#lib/learn/articles.ts";
</script>

<Article article={getArticle("what-is-rsvp")} />
