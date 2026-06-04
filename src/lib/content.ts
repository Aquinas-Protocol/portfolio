// Single validated source of content. Every JSON file is parsed through Zod at build time, so a
// typo or shape mismatch fails `astro build` (PRD §7). The telemetry seed additionally runs the
// §8 denylist as a build invariant.
import { z } from 'zod';
import { isForbidden } from './telemetry';

import profileJson from '../content/profile.json';
import statsJson from '../content/stats.json';
import systemsJson from '../content/systems.json';
import experienceJson from '../content/experience.json';
import channelsJson from '../content/channels.json';
import careerStatsJson from '../content/career_stats.json';
import seedJson from '../content/telemetry_seed.json';

const spark = z.object({ stroke: z.string(), points: z.string() });
const badge = z.object({ label: z.string(), cls: z.string() });

const ProfileSchema = z.object({
  name: z.string(),
  brand: z.string(),
  callsign: z.string(),
  roleFamily: z.string(),
  location: z.string(),
  yearsExperience: z.string(),
  focus: z.string(),
  availabilityLabel: z.string(),
  hero: z.object({ stamp: z.string(), headPre: z.string(), headGrad: z.string(), headPost: z.string(), sub: z.string() }),
  operator: z.object({
    fileNo: z.string(),
    idCode: z.string(),
    cells: z.array(z.object({ k: z.string(), v: z.string(), tone: z.string().optional() })),
    statusLeft: z.string(),
    statusRight: z.string(),
  }),
  availability: z.object({
    headline: z.string(),
    location: z.string(),
    engagement: z.string(),
    earliestStart: z.string(),
    contract: z.string(),
    visa: z.string(),
    targetTags: z.array(z.string()),
  }),
  contactMeta: z.object({ stamp: z.string(), lede: z.string(), allChannels: z.string(), fastest: z.string(), slowest: z.string(), bestFirst: z.string() }),
  footer: z.object({ sig: z.string(), rightSig: z.string() }),
  handles: z.object({ email: z.string(), github: z.string(), githubLabel: z.string(), linkedin: z.string(), linkedinLabel: z.string(), resume: z.string() }),
});

const StatSchema = z.object({ k: z.string(), v: z.string(), t: z.string(), tClass: z.string(), spark });
const CareerStatSchema = z.object({ k: z.string(), v: z.string(), vClass: z.string(), t: z.string() });

const SystemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  statusLabel: z.string(),
  badge,
  desc: z.string(),
  grid: z.object({
    telHead: z.string(),
    telRight: z.string(),
    val: z.string(),
    unit: z.string(),
    spark,
    stackMini: z.array(z.string()),
    footLeft: z.string(),
    footStatusDot: z.boolean(),
  }),
  detail: z.object({
    stamp: z.string(),
    sub: z.string(),
    metaBadges: z.array(badge),
    repoUrl: z.string().nullable(),
    repoLabel: z.string(),
    isPrivate: z.boolean(),
    kpis: z.array(z.object({ k: z.string(), v: z.string(), vCls: z.string(), t: z.string() })),
    paragraphs: z.array(z.string()),
    featureList: z.array(z.object({ name: z.string(), desc: z.string() })),
    stackMatrix: z.array(z.object({ l: z.string(), n: z.string() })),
    deps: z.array(z.object({ name: z.string(), ver: z.string() })),
    commits: z.array(z.object({ h: z.string(), msg: z.string(), t: z.string() })),
    related: z.array(z.object({ name: z.string(), meta: z.string(), slug: z.string() })),
  }),
});

const RoleSchema = z.object({
  when: z.string(),
  dur: z.string(),
  current: z.boolean(),
  title: z.string(),
  org: z.string(),
  badges: z.array(badge),
  stat: z.array(z.string()),
  mission: z.string(),
  achievements: z.array(z.object({ metric: z.string(), metricCls: z.string(), desc: z.string() })),
  programs: z.array(z.string()),
  tools: z.array(z.string()),
  awards: z.array(z.object({ name: z.string() })),
});

const ChannelSchema = z.object({
  icon: z.string(),
  iconClass: z.string(),
  name: z.string(),
  handle: z.string(),
  best: z.string(),
  badge: z.string(),
  badgeClass: z.string(),
  rt: z.string(),
  action: z.string(),
  href: z.string().nullable(),
  live: z.boolean(),
  comingSoon: z.boolean().optional(),
});

const SeedSchema = z.object({
  events: z.array(
    z.object({
      ts: z.string(),
      src: z.string(),
      cls: z.enum(['p', 'c', 'g', 'a', 'r']),
      msg: z.string().refine((s) => !isForbidden(s), { message: '§8 denylist violation in telemetry_seed.json' }),
    }),
  ),
});

export const profile = ProfileSchema.parse(profileJson);
export const stats = z.array(StatSchema).parse(statsJson);
export const systems = z.array(SystemSchema).parse(systemsJson);
export const experience = z.array(RoleSchema).parse(experienceJson);
export const channels = z.array(ChannelSchema).parse(channelsJson);
export const careerStats = z.array(CareerStatSchema).parse(careerStatsJson);
export const telemetrySeed = SeedSchema.parse(seedJson);

export type System = z.infer<typeof SystemSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Stat = z.infer<typeof StatSchema>;
export type CareerStat = z.infer<typeof CareerStatSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
