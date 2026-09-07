/**
 * One-time builder: candidates.json + hand labels -> golden.json.
 *
 * The labels below are the judgment being encoded. They are the product, not
 * the code, and they are meant to be argued with: edit golden.json directly,
 * or edit the table here and re-run `node classify/evals/build-golden.mjs`.
 *
 * Labelling standard used, applied consistently to all 72:
 *   relevant=true  the author is a founder / solo dev / small product team AND
 *                  describes a customer-acquisition or audience-visibility
 *                  problem IntentOwl plausibly helps with.
 *   relevant=false anything else - hiring, agencies and freelancers, customer
 *                  *support*, enterprise billing, tech topics, and anyone
 *                  selling a monitoring tool of their own.
 *
 * Score bands are ranges rather than exact numbers: an eval that demands an
 * exact integer measures noise, not quality. The bands encode "roughly which
 * tier", which is what ranking downstream actually depends on.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

// [candidateIndex, relevant, intent, minScore, maxScore, note]
const LABELS = [
  [0, 1, "pain_point", 40, 75, "Founder asking how others found their first customers - the acquisition problem IntentOwl serves."],
  [1, 1, "question", 35, 70, "Same question, near-empty body: genuinely ambiguous, belongs in the escalation band."],
  [2, 0, "pain_point", 15, 40, "Freelancer chasing clients, not a SaaS founder. ICP miss."],
  [3, 1, "pain_point", 40, 75, "B2B founder asking how to find first customers."],
  [4, 1, "pain_point", 40, 75, "Founder asking how others found first paying customers."],
  [5, 0, "pain_point", 10, 40, "Mobile dev agency seeking clients - agencies are a stated disqualifier."],
  [6, 0, "question", 5, 30, "API monetisation and pricing, not audience discovery."],
  [7, 0, "question", 5, 30, "Looking for a problem to solve, not for customers."],
  [8, 0, "question", 10, 35, "Validation methodology question."],
  [9, 0, "pain_point", 10, 35, "Employee to consultant transition. ICP miss."],
  [10, 1, "pain_point", 50, 85, "Launched, now trying to build a community and get users. Direct fit."],
  [11, 1, "buying_intent", 55, 90, "Wants to find people who already have the problem - literally what IntentOwl does."],
  [12, 1, "buying_intent", 55, 90, "SaaS beta, asking for practices to attract users. Strong buying intent."],
  [13, 0, "pain_point", 10, 35, "Soliciting HN directly to promote an MVP."],
  [14, 0, "question", 5, 25, "Website redesign feedback request."],
  [15, 0, "none", 0, 15, "Drupal vs Rails stack choice."],
  [16, 0, "buying_intent", 10, 35, "Shopping for an email-collection tool - buying intent, wrong category."],
  [17, 0, "none", 0, 20, "Review-my-startup promotion."],
  [18, 1, "pain_point", 55, 90, "Solo founder, laid off, explicitly cannot market their SaaS. Strong fit."],
  [19, 1, "pain_point", 50, 85, "Developer asking how to market an API SaaS."],
  [20, 1, "pain_point", 45, 80, "Launching a SaaS, asking how to market it."],
  [21, 0, "question", 10, 35, "Positioning question, not acquisition."],
  [22, 1, "pain_point", 55, 90, "How to market a SaaS without spending thousands. Bullseye."],
  [23, 1, "pain_point", 50, 85, "Asking how to reach a specific founder audience."],
  [24, 0, "question", 5, 30, "Brand architecture question across two products."],
  [25, 0, "none", 0, 20, "Revenue success story, promotional."],
  [26, 1, "pain_point", 65, 95, "Marketing as a solo technical founder - the exact ICP and the exact pain."],
  [27, 1, "pain_point", 60, 95, "Building vs marketing as a solo founder. Bullseye ICP."],
  [28, 1, "pain_point", 50, 85, "Solo founder asking how to approach marketing."],
  [29, 0, "none", 0, 20, "Seeking a co-founder - recruitment."],
  [30, 0, "none", 0, 20, "Promoting their own shopping search engine."],
  [31, 0, "buying_intent", 15, 40, "Shopping for graphic design tools. Wrong category."],
  [32, 1, "question", 35, 70, "Analysed r/SideProject launches - interested in exactly this data. Ambiguous: user or competitor."],
  [33, 0, "none", 5, 30, "Building AI marketing tools - a vendor, not a buyer."],
  [34, 1, "pain_point", 55, 90, "Traffic but no conversions - SaaS founder with a marketing problem."],
  [35, 0, "none", 0, 20, "Revenue success story, promotional."],
  [36, 0, "none", 0, 20, "Promoting their AI Co-Founder product."],
  [37, 0, "none", 0, 15, "SEO content about reputation management."],
  [38, 0, "none", 0, 15, "LOOQME is a competing brand-monitoring product. Seller, not buyer."],
  [39, 0, "none", 0, 20, "Review-our-startup promotion."],
  [40, 0, "none", 0, 20, "MightyBrand brand monitoring - a direct competitor promoting itself."],
  [41, 0, "none", 0, 20, "Mentionedby.ai - a competing monitoring product."],
  [42, 0, "none", 0, 15, "Coinbase customer support complaint. Support is not acquisition."],
  [43, 0, "question", 5, 25, "How to handle customer support. Different problem entirely."],
  [44, 0, "question", 0, 20, "Customer support anecdotes."],
  [45, 0, "pain_point", 5, 25, "Emotional toll of customer support. Real pain, wrong pain."],
  [46, 0, "none", 0, 15, "OpenAI billing complaint."],
  [47, 0, "question", 0, 20, "Speculation about AI customer support."],
  [48, 0, "none", 0, 10, "BrowserStack incident notice."],
  [49, 0, "question", 5, 25, "Enterprise source-code escrow question."],
  [50, 0, "question", 5, 25, "How enterprise customers pay. Billing, not acquisition."],
  [51, 0, "question", 5, 30, "Enterprise pricing question."],
  [52, 0, "question", 5, 25, "Duplicate of the enterprise payment question."],
  [53, 0, "none", 0, 10, "Hiring post."],
  [54, 0, "question", 0, 15, "Equity for a first employee."],
  [55, 0, "question", 0, 15, "Employee onboarding."],
  [56, 0, "question", 0, 15, "Career advice."],
  [57, 0, "none", 0, 15, "Meta commentary about job posts."],
  [58, 0, "none", 0, 15, "Show HN launch - the author is selling."],
  [59, 0, "none", 0, 15, "Show HN multiplayer game API - selling."],
  [60, 0, "none", 0, 15, "Show HN freelancer lead tool - selling, and an adjacent competitor."],
  [61, 0, "none", 0, 15, "Show HN feedback analysis - selling."],
  [62, 0, "none", 0, 15, "Show HN review collection - selling."],
  [63, 0, "none", 0, 15, "Show HN 360 feedback - selling."],
  [64, 0, "none", 0, 10, "Rust performance article."],
  [65, 0, "none", 0, 10, "Rust compiler performance."],
  [66, 0, "none", 0, 10, "Rust performance book."],
  [67, 0, "none", 0, 10, "Rust benchmarking tool."],
  [68, 0, "none", 0, 10, "Kubernetes and the DevOps job market."],
  [69, 0, "none", 0, 10, "Leaving Kubernetes."],
  [70, 0, "none", 0, 10, "Kubernetes operational pain. Wrong domain."],
  [71, 0, "none", 0, 10, "Speculation about what follows Kubernetes."],
];

const PROFILE = {
  name: "IntentOwl",
  productDesc:
    "IntentOwl is a daily intent-lead digest for SaaS founders. It monitors Reddit, Hacker News and Bluesky for posts showing buying intent or describing a problem the customer's product solves, classifies each one with Claude against the customer's ICP, and emails a ranked digest with a suggested reply angle for every lead. It never posts replies - a human always sends them.",
  icpDesc:
    "Solo founders and small SaaS teams (1-10 people) doing community marketing by hand: manually scrolling subreddits, wiring up keyword alerts, or simply missing the threads where someone is asking for exactly what they build. Usually technical, short on time, and uncomfortable with marketing. They have a live product and are trying to reach early customers.",
  competitors: ["GummySearch", "Syften", "F5Bot", "Brand24", "Mention", "BuzzSumo", "Google Alerts"],
  disqualifiers: [
    "Job postings, recruitment, and people advertising their own availability",
    "Agencies and freelancers looking for clients - we sell to product companies, not services businesses",
    "Anyone building or promoting their own social listening, brand monitoring or lead-monitoring tool: they are a competitor, not a buyer",
    "Customer support, billing and enterprise contract questions - a different problem from finding customers",
  ],
};

/**
 * The watch configuration for this customer.
 *
 * It lives here rather than in a test file so the golden set describes the
 * customer completely: the profile the classifier judges against, AND the
 * filter that decides what ever reaches the classifier at all. Tuning terms is
 * a free, offline loop against `filter/recall.test.ts`.
 *
 * The original eight terms retained 5 of 17 real leads and six of them matched
 * nothing whatsoever, so every term below has been checked against the corpus.
 */
const FILTER = {
  includeTerms: [
    // acquisition
    "find customers",
    "first customers",
    "first users",
    "beta users",
    "find users",
    "attract users",
    "customer acquisition",
    // marketing, as a founder rather than as a discipline
    "market saas",
    "marketing saas",
    "marketing founder",
    "marketing solo",
    // the category itself — these fire on Reddit rather than HN
    "monitor reddit",
    "social listening",
    "brand mentions",
    "monitor mentions",
  ],
  excludeTerms: [
    // Scoped tightly on purpose. A bare "hiring" kills the single best lead in
    // the corpus, whose body reads "hiring a paid marketer when you have zero
    // revenue feels just as scary". Quoted terms match as exact phrases.
    '"who is hiring"',
    '"for hire"',
    "upwork",
    "fiverr",
  ],
};

const candidates = JSON.parse(readFileSync(here("./candidates.json"), "utf8"));

const cases = LABELS.map(([index, relevant, intent, minScore, maxScore, note]) => {
  const c = candidates[index];
  if (c === undefined) throw new Error(`no candidate at index ${index}`);
  return {
    id: c.id,
    url: c.url,
    source: c.source,
    venue: c.venue,
    title: c.title,
    body: c.body,
    expect: { relevant: Boolean(relevant), intent, minScore, maxScore },
    note,
  };
});

const positives = cases.filter((c) => c.expect.relevant).length;
writeFileSync(
  here("./golden.json"),
  `${JSON.stringify({ profile: PROFILE, filter: FILTER, cases }, null, 2)}\n`,
);
console.log(
  `golden.json: ${cases.length} cases, ${positives} relevant, ${cases.length - positives} not ` +
    `(${Math.round((positives / cases.length) * 100)}% positive)`,
);
