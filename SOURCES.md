# Sources

The sweep list for every edition. **Primary** sources (labs, papers, governments, court filings, security vendors' own reports) are always preferred for the link beside a headline; **secondary** sources (press, newsletters, aggregators) are used to discover stories and as corroboration. Wherever a secondary source reports on a primary document, link the primary document too.

Fetch hints: `WebFetch` works on most pages below. RSS/Atom URLs are listed where they exist because they are the most reliable "what changed in the last 24h" signal.

**Known to block the fetcher** (confirmed 11 Sep 2026 — do not retry with curl/archives; use `WebSearch` result text, RSS feeds where listed, or an alternative openable source, and say in the bullet where the figures came from): Reuters, Bloomberg, WSJ, NYT, FT, The Information, Wired, The Verge, Ars Technica, AP, The Guardian, CNBC, Axios article pages, BleepingComputer, `openai.com/index/*` article pages (the RSS feed `openai.com/news/rss.xml` and `developers.openai.com` docs work), Data Center Dynamics article pages (index pages work), Oracle newsroom (investor.oracle.com works), x.ai, Nature (auth redirect), smol.ai (402), FDA newsroom index (401 — search for the specific press release URL instead). `WebSearch` with `allowed_domains` also rejects reuters.com, wsj.com, nytimes.com, wired.com, theverge.com, arstechnica.com, businessinsider.com — search without the domain filter and use whatever result text is visible.

## 1. Frontier labs (primary)

| Source | URL | Feed / notes |
|---|---|---|
| Anthropic — News | https://www.anthropic.com/news | Model launches, policy, threat-intel reports |
| Anthropic — Research | https://www.anthropic.com/research | |
| Anthropic — Alignment Science blog | https://alignment.anthropic.com/ | |
| Anthropic — Frontier Red Team | https://red.anthropic.com/ | Cyber/bio capability evaluations |
| Anthropic — Threat intelligence reports | https://www.anthropic.com/threat-intelligence-report-september-2026 | The report that started this briefing. Watch for successors on the News page. |
| OpenAI — News | https://openai.com/news/ | https://openai.com/news/rss.xml |
| OpenAI — Research | https://openai.com/research/ | |
| OpenAI — Global affairs (malicious-use disruption reports) | https://openai.com/global-affairs/ | |
| Google DeepMind — Blog | https://deepmind.google/discover/blog/ | |
| Google — The Keyword (AI) | https://blog.google/technology/ai/ | https://blog.google/technology/ai/rss/ |
| Google Research blog | https://research.google/blog/ | |
| Meta AI | https://ai.meta.com/blog/ | |
| Microsoft Research | https://www.microsoft.com/en-us/research/blog/ | https://www.microsoft.com/en-us/research/feed/ |
| xAI | https://x.ai/news | |
| Mistral | https://mistral.ai/news | |
| DeepSeek | https://api-docs.deepseek.com/news | Also https://github.com/deepseek-ai |
| Qwen (Alibaba) | https://qwenlm.github.io/blog/ | |
| Moonshot / Kimi | https://moonshotai.github.io/ | Also https://github.com/MoonshotAI |
| Zhipu / Z.ai | https://z.ai/blog | |
| NVIDIA blog | https://blogs.nvidia.com/ | https://blogs.nvidia.com/feed/ |
| Hugging Face — Blog | https://huggingface.co/blog | https://huggingface.co/blog/feed.xml |
| Hugging Face — Daily papers | https://huggingface.co/papers | Community-curated new papers, good for "what researchers are reading" |
| AI2 (Allen Institute) | https://allenai.org/blog | |
| Cohere | https://cohere.com/blog | |

## 2. Research (primary)

| Source | URL | Notes |
|---|---|---|
| arXiv cs.AI — new | https://arxiv.org/list/cs.AI/new | RSS: https://rss.arxiv.org/rss/cs.AI |
| arXiv cs.LG — new | https://arxiv.org/list/cs.LG/new | RSS: https://rss.arxiv.org/rss/cs.LG |
| arXiv cs.CL — new | https://arxiv.org/list/cs.CL/new | RSS: https://rss.arxiv.org/rss/cs.CL |
| arXiv cs.CR — new | https://arxiv.org/list/cs.CR/new | Security papers; RSS: https://rss.arxiv.org/rss/cs.CR |
| arXiv cs.CY — new | https://arxiv.org/list/cs.CY/new | Computers & society |
| alphaXiv trending | https://www.alphaxiv.org/ | Trending papers with discussion |
| Nature — Machine learning | https://www.nature.com/subjects/machine-learning | Nature/Science papers are usually the "big result" of the day |
| Science | https://www.science.org/news | |
| Epoch AI | https://epoch.ai/ | Compute trends, benchmarks, data — always cite for numbers |
| METR | https://metr.org/research | Autonomy/time-horizon evals |
| Apollo Research | https://www.apolloresearch.ai/research | Scheming/deception evals |
| Redwood Research | https://blog.redwoodresearch.org/ | AI control |
| Transluce | https://transluce.org/ | Interpretability & auditing |
| UK AI Security Institute | https://www.aisi.gov.uk/ | Frontier model evaluations, research agenda |
| US CAISI (NIST) | https://www.nist.gov/caisi | |
| AI Alignment Forum | https://www.alignmentforum.org/ | |
| LessWrong (AI tag) | https://www.lesswrong.com/tag/ai | |
| Stanford HAI | https://hai.stanford.edu/news | AI Index and policy research |
| Google Scholar alerts are not available — use WebSearch with `site:arxiv.org` for topics of the day | | |

## 3. Security, misuse & threat intelligence

| Source | URL | Notes |
|---|---|---|
| Google Threat Intelligence Group | https://cloud.google.com/blog/topics/threat-intelligence | Adversarial misuse of Gemini reports |
| Mandiant | https://cloud.google.com/blog/topics/threat-intelligence | |
| Microsoft Threat Intelligence | https://www.microsoft.com/en-us/security/blog/topic/threat-intelligence/ | |
| Microsoft Digital Defense Report | https://www.microsoft.com/en-us/security/security-insider/ | |
| CISA news & advisories | https://www.cisa.gov/news-events/cybersecurity-advisories | |
| UK NCSC | https://www.ncsc.gov.uk/section/keep-up-to-date/all-news | |
| The Record (Recorded Future) | https://therecord.media/ | https://therecord.media/feed |
| Recorded Future — Insikt Group | https://www.recordedfuture.com/research | |
| Palo Alto Unit 42 | https://unit42.paloaltonetworks.com/ | |
| CrowdStrike blog | https://www.crowdstrike.com/en-us/blog/ | |
| Check Point Research | https://research.checkpoint.com/ | |
| Proofpoint threat insight | https://www.proofpoint.com/us/blog/threat-insight | |
| Sophos X-Ops | https://news.sophos.com/en-us/category/threat-research/ | |
| Trend Micro Research | https://www.trendmicro.com/en_us/research.html | |
| ESET WeLiveSecurity | https://www.welivesecurity.com/ | |
| Krebs on Security | https://krebsonsecurity.com/ | https://krebsonsecurity.com/feed/ |
| BleepingComputer | https://www.bleepingcomputer.com/ | https://www.bleepingcomputer.com/feed/ |
| Dark Reading | https://www.darkreading.com/ | |
| The Register — Security | https://www.theregister.com/security/ | |
| Wired — Security | https://www.wired.com/category/security/ | |
| 404 Media | https://www.404media.co/ | Strong on AI misuse, scams, surveillance |
| Graphika | https://graphika.com/reports | Influence operations |
| DFRLab | https://dfrlab.org/ | Influence operations |
| Meta — Adversarial Threat Reports | https://about.fb.com/news/tag/coordinated-inauthentic-behavior/ | |
| Europol | https://www.europol.europa.eu/media-press/newsroom | |
| AI Incident Database | https://incidentdatabase.ai/ | |
| MITRE ATLAS | https://atlas.mitre.org/ | Adversarial ML tactics |
| OWASP GenAI Security Project | https://genai.owasp.org/ | |
| Simon Willison (prompt injection, agent security) | https://simonwillison.net/ | https://simonwillison.net/atom/everything/ |

## 4. Military, defense & geopolitics

| Source | URL | Notes |
|---|---|---|
| Breaking Defense — AI | https://breakingdefense.com/tag/artificial-intelligence/ | |
| Defense One — AI | https://www.defenseone.com/topic/artificial-intelligence/ | |
| DefenseScoop | https://defensescoop.com/ | Pentagon AI/CDAO coverage |
| C4ISRNET | https://www.c4isrnet.com/artificial-intelligence/ | |
| War on the Rocks | https://warontherocks.com/ | |
| DARPA news | https://www.darpa.mil/news | |
| Defense Innovation Unit | https://www.diu.mil/latest | |
| US DoD releases | https://www.defense.gov/News/Releases/ | |
| NATO news | https://www.nato.int/cps/en/natohq/news.htm | |
| Lawfare | https://www.lawfaremedia.org/ | Law + national security |
| CSET (Georgetown) | https://cset.georgetown.edu/publications/ | China/AI, chips, talent data |
| CNAS | https://www.cnas.org/research | |
| CSIS | https://www.csis.org/analysis | |
| RAND | https://www.rand.org/topics/artificial-intelligence.html | |
| Carnegie Endowment | https://carnegieendowment.org/programs/technology | |
| IISS | https://www.iiss.org/online-analysis/ | |
| Stop Killer Robots | https://www.stopkillerrobots.org/news/ | Autonomous weapons, UN CCW |
| ChinaTalk | https://www.chinatalk.media/ | China AI policy/industry |
| ChinAI newsletter | https://chinai.substack.com/ | Translations of Chinese AI discourse |

## 5. Health, science & medicine

| Source | URL | Notes |
|---|---|---|
| FDA — AI-enabled medical devices list | https://www.fda.gov/medical-devices/software-medical-device-samd/artificial-intelligence-enabled-medical-devices | Watch for new clearances |
| FDA press announcements | https://www.fda.gov/news-events/fda-newsroom/press-announcements | |
| STAT News — AI | https://www.statnews.com/topic/artificial-intelligence/ | Best daily health-AI reporting |
| NEJM AI | https://ai.nejm.org/ | |
| Nature Medicine | https://www.nature.com/nm/ | |
| The Lancet Digital Health | https://www.thelancet.com/journals/landig/home | |
| JAMA Network (AI) | https://jamanetwork.com/collections/44024/artificial-intelligence | |
| medRxiv | https://www.medrxiv.org/ | Preprints |
| bioRxiv | https://www.biorxiv.org/ | Preprints |
| Isomorphic Labs | https://www.isomorphiclabs.com/articles | |
| Endpoints News | https://endpts.com/ | Biotech + AI |
| Fierce Biotech | https://www.fiercebiotech.com/ | |
| NIH news | https://www.nih.gov/news-events/news-releases | |
| WHO news | https://www.who.int/news | |
| Google Health | https://health.google/ | |
| Quanta Magazine | https://www.quantamagazine.org/ | AI for science |
| MIT Technology Review | https://www.technologyreview.com/topic/artificial-intelligence/ | https://www.technologyreview.com/feed/ |

## 6. Policy, regulation & law

| Source | URL | Notes |
|---|---|---|
| EU AI Office | https://digital-strategy.ec.europa.eu/en/policies/ai-office | AI Act implementation, GPAI code |
| European Commission — Digital | https://digital-strategy.ec.europa.eu/en/news | |
| White House OSTP / AI actions | https://www.whitehouse.gov/ostp/ | Executive orders, AI Action Plan |
| Federal Register (AI search) | https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=%22artificial+intelligence%22 | Rules and notices |
| NIST AI | https://www.nist.gov/artificial-intelligence | |
| FTC press releases | https://www.ftc.gov/news-events/news/press-releases | |
| SEC press releases | https://www.sec.gov/newsroom/press-releases | |
| US Congress (bills mentioning AI) | https://www.congress.gov/search?q=%7B%22source%22%3A%22legislation%22%2C%22search%22%3A%22artificial+intelligence%22%7D | |
| California Legislature | https://leginfo.legislature.ca.gov/ | SB 53 and successors |
| UK DSIT | https://www.gov.uk/government/organisations/department-for-science-innovation-and-technology | |
| OECD.AI | https://oecd.ai/en/ | Policy observatory |
| China — CAC | https://www.cac.gov.cn/ | Generative AI rules; use WebSearch for English coverage |
| CourtListener | https://www.courtlistener.com/ | Dockets: NYT v. OpenAI, Bartz v. Anthropic, Kadrey v. Meta, Getty v. Stability, etc. |
| Tech Policy Press | https://www.techpolicy.press/ | |
| Lawfare (also §4) | https://www.lawfaremedia.org/ | |
| Brookings — AI | https://www.brookings.edu/topics/artificial-intelligence/ | |
| IAPP | https://iapp.org/news/ | Privacy + AI governance |
| Ada Lovelace Institute | https://www.adalovelaceinstitute.org/ | |
| CDT | https://cdt.org/ | |
| EPIC | https://epic.org/ | |
| AI Now Institute | https://ainowinstitute.org/ | |
| Future of Life Institute | https://futureoflife.org/ | |
| Politico — AI | https://www.politico.com/tag/artificial-intelligence | |
| Axios — AI+ | https://www.axios.com/technology/ai | |

## 7. Compute, chips, infrastructure & industry

| Source | URL | Notes |
|---|---|---|
| Reuters — AI | https://www.reuters.com/technology/artificial-intelligence/ | Use WebSearch `allowed_domains: ["reuters.com"]` |
| Bloomberg — Technology | https://www.bloomberg.com/technology | WebSearch only |
| Financial Times — AI | https://www.ft.com/artificial-intelligence | WebSearch only |
| Wall Street Journal — Tech | https://www.wsj.com/tech/ai | WebSearch only |
| The Information | https://www.theinformation.com/ | WebSearch only; headlines only |
| CNBC — AI | https://www.cnbc.com/ai-artificial-intelligence/ | |
| TechCrunch — AI | https://techcrunch.com/category/artificial-intelligence/ | https://techcrunch.com/category/artificial-intelligence/feed/ |
| The Verge — AI | https://www.theverge.com/ai-artificial-intelligence | |
| Ars Technica — AI | https://arstechnica.com/ai/ | https://arstechnica.com/ai/feed/ |
| Wired — AI | https://www.wired.com/tag/artificial-intelligence/ | |
| SemiAnalysis | https://semianalysis.com/ | Chips/compute deep dives |
| Tom's Hardware | https://www.tomshardware.com/ | GPU/fab news |
| Data Center Dynamics | https://www.datacenterdynamics.com/en/ | Datacenter buildouts, power |
| Utility Dive | https://www.utilitydive.com/ | AI power demand |
| SEC EDGAR full-text search | https://efts.sec.gov/LATEST/search-index?q=%22artificial%20intelligence%22 | Filings mentioning AI |
| Epoch AI (also §2) | https://epoch.ai/data | Compute, cost, model data |

## 8. Society, labor, deployment — the good and the bad

| Source | URL | Notes |
|---|---|---|
| AP News — AI | https://apnews.com/hub/artificial-intelligence | |
| The Guardian — AI | https://www.theguardian.com/technology/artificialintelligenceai | |
| NYT — AI | https://www.nytimes.com/spotlight/artificial-intelligence | WebSearch |
| Rest of World | https://restofworld.org/ | AI outside the US/EU |
| The Markup | https://themarkup.org/ | Algorithmic harms investigations |
| ProPublica | https://www.propublica.org/ | |
| Platformer | https://www.platformer.news/ | |
| Pew Research — AI | https://www.pewresearch.org/topic/science/science-issues/artificial-intelligence/ | Survey data |
| Reuters Institute | https://reutersinstitute.politics.ox.ac.uk/ | AI + news |
| AlgorithmWatch | https://algorithmwatch.org/en/ | |

## 9. Newsletters & aggregators (secondary — discovery only)

| Source | URL | Notes |
|---|---|---|
| Import AI (Jack Clark) | https://importai.substack.com/ | Weekly; strong on research + policy |
| Interconnects (Nathan Lambert) | https://www.interconnects.ai/ | Open models, RL |
| Transformer (Shakeel Hashim) | https://www.transformernews.ai/ | AI politics/safety |
| Don't Worry About the Vase (Zvi) | https://thezvi.substack.com/ | Exhaustive weekly roundups |
| AI Snake Oil | https://www.aisnakeoil.com/ | Sceptical/evidence-based |
| Ahead of AI (Raschka) | https://magazine.sebastianraschka.com/ | Research explainers |
| Latent Space | https://www.latent.space/ | Engineering |
| The Batch (DeepLearning.AI) | https://www.deeplearning.ai/the-batch/ | Weekly |
| Last Week in AI | https://lastweekin.ai/ | Weekly |
| AI News (smol.ai) | https://news.smol.ai/ | Daily, exhaustive Discord/Twitter/Reddit roundup |
| TLDR AI | https://tldr.tech/ai | Daily |
| Techmeme | https://www.techmeme.com/ | Live tech news river |
| Hacker News front page | https://news.ycombinator.com/ | https://hnrss.org/frontpage |
| r/MachineLearning | https://www.reddit.com/r/MachineLearning/ | |
| r/LocalLLaMA | https://www.reddit.com/r/LocalLLaMA/ | Open-weights releases surface here first |
| Google News — AI | https://news.google.com/search?q=artificial%20intelligence | Catch-all |

## Adding sources

Add a row to the right table. Keep the primary/secondary distinction honest: a newsletter is never the link beside a headline if the thing it is describing has its own page.
