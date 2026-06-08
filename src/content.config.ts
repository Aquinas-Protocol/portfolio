// Content collections. The JSON content under src/content/*.json is imported directly by
// src/lib/content.ts (plain Vite imports) and is intentionally NOT a collection. The only
// collection is long-form `writing`: one Markdown file per post under src/content/writing/.
// The file basename is the post id and the URL slug (/writing/<id>/).
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const writing = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/writing' }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    author: z.string().default('Dylan Palumbo'),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false), // unpublished drafts are filtered out of the index and routes
  }),
});

export const collections = { writing };
