/**
 * Event categorizer — regex-based classification with 2-level hierarchy.
 *
 * Categories use slash-separated slugs: "sports/nba", "politics/us-elections".
 * Every matched event gets both the parent and child slug in its categories array.
 * Example: an NBA event gets ["sports", "sports/nba"].
 *
 * Phase 2 (future): async LLM fallback for uncategorized events.
 */

// ─── Types ──────────────────────────────────────────────────

export interface CategoryRule {
  slug: string;        // e.g. "sports/nba"
  parent: string;      // e.g. "sports" (derived from slug)
  label: string;       // e.g. "NBA"
  parentLabel: string; // e.g. "Sports"
  patterns: RegExp[];
}

export interface ClassifyInput {
  title: string;
  description?: string | null;
  gammaCategory?: string | null;
  gammaTags?: string[];
}

export interface CategoryNode {
  slug: string;
  label: string;
  children: { slug: string; label: string }[];
}

// ─── Taxonomy Rules ─────────────────────────────────────────

const rule = (
  slug: string,
  label: string,
  parentLabel: string,
  patterns: RegExp[],
): CategoryRule => ({
  slug,
  parent: slug.split('/')[0],
  label,
  parentLabel,
  patterns,
});

export const CATEGORY_RULES: CategoryRule[] = [
  // ── Sports ──────────────────────────────────────────────
  rule('sports/nba', 'NBA', 'Sports', [
    /\b(nba|lakers|celtics|warriors|bucks|76ers|knicks|nets|heat|suns|nuggets|cavaliers|mavericks|clippers|rockets|grizzlies|timberwolves|thunder|spurs|raptors|hawks|hornets|pistons|pacers|magic|wizards|trail\s*blazers|pelicans|kings|jazz|basketball\s+(game|season|playoff|draft|finals|mvp|all[- ]star))\b/i,
  ]),
  rule('sports/nfl', 'NFL', 'Sports', [
    /\b(nfl|super\s*bowl|big\s+game|chiefs|eagles|49ers|cowboys|packers|bills|ravens|lions|seahawks|patriots|bengals|chargers|broncos|dolphins|falcons|panthers|saints|steelers|texans|titans|jaguars|colts|rams|cardinals|commanders|bears|vikings|jets|giants|touchdown(s)?|quarterback|rushing\s+yard(s)?|wide\s+receiver)\b/i,
  ]),
  rule('sports/mlb', 'MLB', 'Sports', [
    /\b(mlb|world\s+series|yankees|dodgers|astros|braves|phillies|mets|red\s+sox|cubs|padres|mariners|orioles|twins|guardians|rangers|rays|tigers|brewers|reds|blue\s+jays|white\s+sox|royals|pirates|diamondbacks|cardinals\s+(baseball)|rockies|marlins|nationals|athletics|angels|home\s+run(s)?|strikeout(s)?|batting\s+average|pitcher|baseball\s+(game|season|playoff))\b/i,
  ]),
  rule('sports/nhl', 'NHL', 'Sports', [
    /\b(nhl|stanley\s+cup|hockey\s+(game|season|playoff)|maple\s+leafs|canadiens|bruins|rangers\s+(hockey)|penguins|blackhawks|red\s+wings|flyers|oilers|avalanche|lightning|panthers\s+(hockey)|hurricanes|stars\s+(hockey)|wild\s+(hockey)|predators|kraken|flames|canucks|senators|islanders|blue\s+jackets|sabres|ducks|sharks|devils|jets\s+(hockey)|coyotes)\b/i,
  ]),
  rule('sports/soccer', 'Soccer', 'Sports', [
    /\b(premier\s+league|champions\s+league|la\s+liga|bundesliga|serie\s+a|ligue\s+1|mls|world\s+cup|fifa|epl|arsenal|liverpool|man(chester)?\s+(city|united)|chelsea|barcelona|real\s+madrid|psg|bayern(\s+munich)?|juventus|inter\s+milan|ac\s+milan|tottenham|napoli|atletico|dortmund|ajax|benfica|porto|celtic|soccer|football\s+(match|league|club|transfer))\b/i,
  ]),
  rule('sports/mma-boxing', 'MMA & Boxing', 'Sports', [
    /\b(ufc|mma|boxing|fight\s+night|knockout|title\s+fight|heavyweight|middleweight|lightweight|welterweight|bantamweight|flyweight|featherweight|bellator|pfl|ppv\s+fight|dana\s+white|undercard|main\s+event\s+fight|round\s+(1[0-5]|[1-9])|tko|submission|split\s+decision|unanimous\s+decision)\b/i,
  ]),
  rule('sports/tennis', 'Tennis', 'Sports', [
    /\b(tennis|wimbledon|us\s+open\s+(tennis)?|french\s+open|australian\s+open|roland\s+garros|atp|wta|grand\s+slam\s+(tennis|title|final)|djokovic|nadal|federer|alcaraz|sinner|swiatek|sabalenka|gauff)\b/i,
  ]),
  rule('sports/golf', 'Golf', 'Sports', [
    /\b(golf|pga|masters\s+(tournament|golf)|us\s+open\s+golf|the\s+open\s+championship|ryder\s+cup|liv\s+golf|birdie(s)?|eagle\s+(golf)|under\s+par|tiger\s+woods|mcilroy|scheffler|koepka|rahm)\b/i,
  ]),
  rule('sports/f1-motorsport', 'F1 & Motorsport', 'Sports', [
    /\b(formula\s*1|f1|grand\s+prix|nascar|indycar|motogp|le\s+mans|verstappen|hamilton|leclerc|norris|sainz|russell|perez|alonso|red\s+bull\s+racing|ferrari\s+(f1|racing)|mercedes\s+(f1|racing)|mclaren|pit\s+stop|pole\s+position|fastest\s+lap|podium\s+finish|constructors?\s+championship|drivers?\s+championship)\b/i,
  ]),
  rule('sports/college', 'College Sports', 'Sports', [
    /\b(ncaa|march\s+madness|college\s+(football|basketball|world\s+series)|cfp|college\s+football\s+playoff|bowl\s+game|heisman|sec\s+(championship|football|basketball)|big\s+ten|big\s+12|acc\s+(championship|tournament)|pac[- ]12|final\s+four|sweet\s+sixteen|elite\s+eight)\b/i,
  ]),
  rule('sports/cricket', 'Cricket', 'Sports', [
    /\b(cricket|ipl|test\s+match|t20|one\s+day\s+international|odi|ashes|cricket\s+world\s+cup|bcci|ecb\s+cricket|virat\s+kohli|sachin|dhoni|babar\s+azam|wicket(s)?|century\s+(cricket|runs)|bowler|batsman)\b/i,
  ]),
  rule('sports/rugby', 'Rugby', 'Sports', [
    /\b(rugby|six\s+nations|rugby\s+world\s+cup|all\s+blacks|springboks|wallabies|super\s+rugby|premiership\s+rugby|top\s+14\s+rugby|try\s+(rugby)?|scrum|lineout)\b/i,
  ]),
  rule('sports/olympics', 'Olympics', 'Sports', [
    /\b(olympic(s)?|olympic\s+games|summer\s+olympics|winter\s+olympics|gold\s+medal(ist)?|ioc|paralympic(s)?)\b/i,
  ]),
  rule('sports/esports', 'Esports', 'Sports', [
    /\b(esports?|e-sports?|league\s+of\s+legends|dota\s*2|counter[- ]strike|cs\s*2|csgo|valorant|overwatch\s+league|call\s+of\s+duty\s+league|fortnite\s+(tournament|championship|world\s+cup)|lol\s+worlds|the\s+international\s+dota)\b/i,
  ]),
  rule('sports/other', 'Other Sports', 'Sports', [
    /\b(horse\s+racing|kentucky\s+derby|preakness|belmont\s+stakes|triple\s+crown\s+(horse|racing)|tour\s+de\s+france|cycling|swimming\s+(championship|world)|track\s+and\s+field|marathon|triathlon|surfing\s+(championship|world)|skiing|snowboarding|figure\s+skating|curling|lacrosse|volleyball\s+(championship)|polo|rowing|sailing\s+(race|cup)|america'?s\s+cup)\b/i,
  ]),

  // ── Politics ────────────────────────────────────────────
  rule('politics/us-elections', 'US Elections', 'Politics', [
    /\b(presidential\s+(election|race|candidate|primary|debate|nominee)|electoral\s+(college|vote)|midterm(s)?|swing\s+state|red\s+state|blue\s+state|senator\s+(race|election)|congress(ional)?\s+(race|election|seat|district)|governor\s+(race|election)|democratic\s+(nominee|primary|candidate)|republican\s+(nominee|primary|candidate)|gop\s+(nominee|primary|candidate)|ballot|poll(ing|s)?\s+(average|lead|margin)|rnc|dnc|super\s+tuesday|caucus|primary\s+election|general\s+election|run[- ]off|early\s+voting|absentee|popular\s+vote|battleground)\b/i,
  ]),
  rule('politics/us-policy', 'US Policy', 'Politics', [
    /\b(executive\s+order|government\s+shutdown|debt\s+ceiling|federal\s+budget|impeach(ment)?|supreme\s+court\s+(ruling|nomination|justice)|scotus|legislation|filibuster|senate\s+(vote|confirm|bill)|house\s+(vote|bill|speaker)|white\s+house|oval\s+office|cabinet\s+(member|secretary|appointment)|stimulus|infrastructure\s+bill|immigration\s+(policy|reform|bill|ban)|border\s+(wall|security|policy)|gun\s+(control|reform|legislation)|abortion\s+(ban|law|ruling|policy)|roe\s+v|student\s+loan|obamacare|aca|affordable\s+care)\b/i,
  ]),
  rule('politics/world-politics', 'World Politics', 'Politics', [
    /\b(prime\s+minister|parliament(ary)?|election\s+in\s+\w+|brexit|eu\s+(election|parliament|commission)|nato|un\s+(general\s+assembly|security\s+council|resolution)|g[- ]?(7|20)|chancellor|president\s+of\s+\w+|coup|regime\s+change|referendum|coalition\s+government|political\s+party|opposition\s+(leader|party)|sanction(s)?|embargo|annexation|sovereignty|territorial)\b/i,
  ]),
  rule('politics/geopolitics', 'Geopolitics', 'Politics', [
    /\b(china[- ]?(us|taiwan|russia)|us[- ]?china|us[- ]?russia|russia[- ]?ukraine|middle\s+east\s+(conflict|peace|tension|crisis)|north\s+korea|nuclear\s+(deal|weapon|threat|program|test)|arms\s+(race|deal|control)|trade\s+war|cold\s+war|brics|belt\s+and\s+road|south\s+china\s+sea|taiwan\s+strait|military\s+(alliance|buildup|exercise))\b/i,
  ]),
  rule('politics/regulation', 'Regulation', 'Politics', [
    /\b(sec\s+(rule|regulation|enforcement|filing|lawsuit|charges?)|cftc|ftc|doj\s+(investigation|lawsuit|antitrust)|antitrust|regulator(y)?|compliance|legislation\s+(crypto|tech|ai)|ban(ning)?\s+(crypto|tiktok|huawei)|data\s+privacy|gdpr|ccpa|dodd[- ]frank|glass[- ]steagall)\b/i,
  ]),

  // ── Crypto ──────────────────────────────────────────────
  rule('crypto/bitcoin', 'Bitcoin', 'Crypto', [
    /\b(bitcoin|btc|satoshi|lightning\s+network|btc\s+(price|etf|halving|dominance)|bitcoin\s+(price|etf|halving|mining|hash\s+rate|dominance|mempool|ordinals|runes))\b/i,
  ]),
  rule('crypto/ethereum', 'Ethereum', 'Crypto', [
    /\b(ethereum|eth\s+(price|etf|staking|merge|upgrade|gas)|vitalik|ether\s+(price|staking)|eip[- ]?\d+|ethereum\s+(price|etf|staking|upgrade|layer\s*2|gas|blob))\b/i,
  ]),
  rule('crypto/altcoins', 'Altcoins', 'Crypto', [
    /\b(solana|sol\s+(price|token)|cardano|ada\s+(price|token)|polkadot|dot\s+(price|token)|avalanche|avax|polygon|matic|chainlink|link\s+(price|token)|cosmos|atom\s+(price|token)|near\s+(protocol|price|token)|aptos|sui\s+(blockchain|token|price)|arbitrum|optimism\s+(token|chain)|ton\s+(blockchain|token)|sei\s+network|celestia|tia\s+token|litecoin|ltc\s+(price|halving)|ripple|xrp\s+(price|lawsuit|ruling)|stellar|xlm|algorand|algo\s+token)\b/i,
  ]),
  rule('crypto/defi', 'DeFi', 'Crypto', [
    /\b(defi|decentralized\s+finance|tvl\s+(total|locked)|yield\s+(farm|protocol)|liquidity\s+pool|amm|dex\s+(volume|aggregator)|aave|uniswap|compound\s+(finance|protocol)|maker\s*dao|curve\s+(finance|protocol)|lido|restaking|eigenlayer|pendle|lending\s+protocol|flash\s+loan|impermanent\s+loss)\b/i,
  ]),
  rule('crypto/nfts', 'NFTs', 'Crypto', [
    /\b(nft(s)?|non[- ]fungible|bored\s+ape|bayc|cryptopunk(s)?|azuki|pudgy\s+penguin(s)?|degen\s+ape|opensea|blur\s+(nft|marketplace)|nft\s+(floor|mint|drop|collection|marketplace))\b/i,
  ]),
  rule('crypto/exchanges', 'Exchanges', 'Crypto', [
    /\b(binance|coinbase|kraken|okx|bybit|bitfinex|huobi|htx|crypto\.com|gemini|ftx\s+(bankruptcy|trial|estate)|cex\s+(volume|listing)|exchange\s+(listing|hack|volume|delist))\b/i,
  ]),
  rule('crypto/stablecoins', 'Stablecoins', 'Crypto', [
    /\b(stablecoin(s)?|usdt|usdc|tether|circle|dai\s+(stablecoin|peg)|depeg|peg(ged)?|frax|paypal\s+(stablecoin|pyusd)|cbdc|central\s+bank\s+digital)\b/i,
  ]),
  rule('crypto/memecoins', 'Memecoins', 'Crypto', [
    /\b(memecoin(s)?|meme\s+coin(s)?|doge(coin)?|shib(a)?|pepe\s+(coin|token)|floki|bonk|wif|dogwifhat|brett|popcat|mog|turbo\s+token|wojak\s+token)\b/i,
  ]),

  // ── Finance ─────────────────────────────────────────────
  rule('finance/stocks', 'Stocks', 'Finance', [
    /\b(stock\s+(market|price|split)|s&p\s*500|nasdaq|dow\s+jones|nyse|russell\s+2000|market\s+cap|bull\s+(market|run)|bear\s+market|correction|aapl|msft|goog|googl|amzn|nvda|tsla|meta\s+(stock|share)|apple\s+(stock|share|earning)|microsoft\s+(stock|share)|google\s+(stock|share)|amazon\s+(stock|share)|nvidia\s+(stock|share)|tesla\s+(stock|share))\b/i,
  ]),
  rule('finance/fed-rates', 'Fed & Rates', 'Finance', [
    /\b(federal\s+reserve|fed\s+(rate|cut|hike|pivot|meeting|decision|funds)|fomc|interest\s+rate(s)?|rate\s+(cut|hike|decision|pause|hold)|powell|monetary\s+policy|quantitative\s+(easing|tightening)|qt|qe|treasury\s+yield(s)?|yield\s+curve|bond\s+market|10[- ]year\s+yield)\b/i,
  ]),
  rule('finance/macro', 'Macro', 'Finance', [
    /\b(inflation|cpi|ppi|gdp|unemployment\s+(rate|claims)|nonfarm\s+payroll(s)?|jobs\s+report|recession|soft\s+landing|hard\s+landing|economic\s+(growth|outlook|data|indicator)|consumer\s+(spending|confidence|sentiment)|retail\s+sales|pmi|ism\s+manufacturing|trade\s+(deficit|surplus|balance)|national\s+debt|fiscal\s+(policy|deficit))\b/i,
  ]),
  rule('finance/commodities', 'Commodities', 'Finance', [
    /\b(gold\s+price|silver\s+price|oil\s+price|crude\s+oil|brent|wti|opec|natural\s+gas\s+price|copper\s+price|commodity\s+(market|price|futures)|wheat\s+price|corn\s+price|soybean|palladium|platinum\s+price|uranium\s+price)\b/i,
  ]),
  rule('finance/forex', 'Forex', 'Finance', [
    /\b(forex|eur\s*\/?\s*usd|gbp\s*\/?\s*usd|usd\s*\/?\s*jpy|dxy|dollar\s+index|exchange\s+rate|currency\s+(pair|market|devaluation)|yen|euro\s+(value|exchange)|yuan|renminbi)\b/i,
  ]),
  rule('finance/ipo-earnings', 'IPO & Earnings', 'Finance', [
    /\b(ipo|initial\s+public\s+offering|earnings\s+(report|call|beat|miss|season|per\s+share|surprise)|eps|revenue\s+(beat|miss|growth|guidance)|quarterly\s+(results|earnings|report)|annual\s+(report|earnings)|profit\s+(margin|warning)|guidance\s+(raise|lower|cut)|market\s+valuation)\b/i,
  ]),

  // ── Entertainment ───────────────────────────────────────
  rule('entertainment/movies-tv', 'Movies & TV', 'Entertainment', [
    /\b(box\s+office|movie\s+(release|premiere|sequel|prequel|franchise)|film\s+(release|premiere)|netflix|disney\s*\+?|hbo|amazon\s+prime\s+video|hulu|streaming\s+(war|service|subscriber)|tv\s+(show|series|season|finale|premiere|rating|renewal|cancel)|emmy|golden\s+globe|sag\s+award|bafta|cannes|sundance|imdb|rotten\s+tomatoes)\b/i,
  ]),
  rule('entertainment/music', 'Music', 'Entertainment', [
    /\b(album\s+(release|sales|chart)|billboard\s+(hot\s+100|200|chart)|grammy|music\s+award|concert\s+tour|spotify\s+(stream|chart)|number\s+one\s+(hit|single|album)|platinum\s+(album|single)|recording\s+artist|music\s+festival|coachella|glastonbury|lollapalooza)\b/i,
  ]),
  rule('entertainment/awards', 'Awards', 'Entertainment', [
    /\b(oscar(s)?|academy\s+award(s)?|best\s+(picture|director|actor|actress|film)|nominee|nomination|award\s+(show|ceremony|winner|season)|tony\s+award|pulitzer|nobel\s+prize)\b/i,
  ]),
  rule('entertainment/gaming', 'Gaming', 'Entertainment', [
    /\b(video\s+game|game\s+(release|launch|sale|review|of\s+the\s+year)|playstation|xbox|nintendo|steam\s+(sale|deck|chart)|game\s+pass|goty|game\s+awards|e3|gamescom|pax|gta\s+[6vi]|elder\s+scrolls|zelda|mario|halo|call\s+of\s+duty\s+(sales|release)|final\s+fantasy|elden\s+ring|baldur'?s\s+gate)\b/i,
  ]),
  rule('entertainment/celebrities', 'Celebrities', 'Entertainment', [
    /\b(celebrity|taylor\s+swift|beyonce|drake\s+(music|album|beef)|kanye|ye\s+(album|controversy)|kardashian|rihanna|bad\s+bunny|travis\s+scott|ariana\s+grande|dua\s+lipa|billie\s+eilish|harry\s+styles|doja\s+cat|olivia\s+rodrigo|sabrina\s+carpenter|chappell\s+roan|celebrity\s+(news|scandal|wedding|divorce|baby|death))\b/i,
  ]),

  // ── Science & Tech ──────────────────────────────────────
  rule('science-tech/ai', 'AI', 'Science & Tech', [
    /\b(artificial\s+intelligence|openai|chatgpt|gpt[- ]?\d|claude\s+(ai|model|anthropic)|anthropic|gemini\s+(ai|model|google)|llm|large\s+language\s+model|machine\s+learning|deep\s+learning|neural\s+network|ai\s+(model|safety|regulation|alignment|startup|chip|agent)|generative\s+ai|transformer\s+model|diffusion\s+model|midjourney|stable\s+diffusion|dall[- ]?e|copilot\s+ai|agi|superintelligence)\b/i,
  ]),
  rule('science-tech/space', 'Space', 'Science & Tech', [
    /\b(spacex|nasa|artemis|starship|falcon\s+(9|heavy)|rocket\s+launch|satellite\s+launch|iss|international\s+space\s+station|blue\s+origin|rocket\s+lab|mars\s+(mission|rover|colony)|moon\s+(landing|mission|base)|james\s+webb|jwst|asteroid|comet|space\s+(station|mission|exploration|launch|shuttle)|orbit(al)?)\b/i,
  ]),
  rule('science-tech/biotech-health', 'Biotech & Health', 'Science & Tech', [
    /\b(vaccine|fda\s+(approval|trial|ruling)|clinical\s+trial|drug\s+approval|biotech|pharmaceutical|gene\s+(therapy|editing)|crispr|mrna|pandemic|epidemic|virus\s+(outbreak|variant)|covid|monkeypox|bird\s+flu|who\s+(declaration|emergency)|health\s+(crisis|emergency)|pfizer|moderna|johnson\s+&\s+johnson|merck|eli\s+lilly|novo\s+nordisk|ozempic|wegovy|glp[- ]1)\b/i,
  ]),
  rule('science-tech/climate-energy', 'Climate & Energy', 'Science & Tech', [
    /\b(climate\s+(change|summit|target|policy|action|crisis)|global\s+warming|carbon\s+(emissions?|capture|tax|credit|neutral|offset)|net\s+zero|renewable\s+energy|solar\s+(energy|panel|farm)|wind\s+(energy|farm|turbine)|ev\s+(sales|adoption|mandate)|electric\s+vehicle|paris\s+agreement|cop\s*\d{2}|greenhouse\s+gas|fossil\s+fuel|nuclear\s+(energy|power|plant)|green\s+energy|clean\s+energy|hydrogen\s+fuel)\b/i,
  ]),
  rule('science-tech/consumer-tech', 'Consumer Tech', 'Science & Tech', [
    /\b(iphone\s+\d+|apple\s+(event|launch|wwdc)|google\s+(pixel|io|event|search)|samsung\s+(galaxy|launch|event)|meta\s+(quest|glasses|ray[- ]ban)|vision\s+pro|android\s+\d+|ios\s+\d+|smartphone\s+(sales|market|launch)|chip\s+(shortage|war|ban)|semiconductor|tsmc|qualcomm|arm\s+(chip|ipo)|intel|amd|5g|6g|tech\s+(layoff|ipo|acquisition|merger))\b/i,
  ]),

  // ── World Events ────────────────────────────────────────
  rule('world-events/conflicts', 'Conflicts', 'World Events', [
    /\b(war\s+in|invasion|ceasefire|peace\s+(deal|talks|agreement|negotiation)|military\s+(operation|strike|offensive)|airstrike|drone\s+strike|insurgency|civil\s+war|armed\s+conflict|battlefield|frontline|casualt(y|ies)|ukraine|russia[- ]ukraine|israel|gaza|hamas|hezbollah|houthi|yemen\s+(conflict|war)|syria|sudan\s+(conflict|war))\b/i,
  ]),
  rule('world-events/disasters', 'Disasters', 'World Events', [
    /\b(earthquake|tsunami|volcano|eruption|wildfire|flood(ing)?|drought|famine|natural\s+disaster|humanitarian\s+crisis|relief\s+effort|death\s+toll\s+(earthquake|hurricane|flood)|dam\s+(collapse|break|failure)|landslide|avalanche|sinkhole|tornado\s+outbreak)\b/i,
  ]),
  rule('world-events/humanitarian', 'Humanitarian', 'World Events', [
    /\b(refugee(s)?|asylum|migration\s+crisis|displaced\s+people|humanitarian\s+aid|food\s+(crisis|shortage|insecurity)|water\s+crisis|poverty\s+(rate|line)|human\s+rights|genocide|ethnic\s+cleansing|war\s+crime(s)?|icc\s+(warrant|ruling)|red\s+cross|unicef|unhcr)\b/i,
  ]),
  rule('world-events/diplomacy', 'Diplomacy', 'World Events', [
    /\b(summit|bilateral\s+(talks|meeting|agreement)|treaty|accord|diplomatic\s+(relations|crisis|incident)|ambassador|embassy|foreign\s+(minister|affairs|policy)|state\s+visit|trade\s+agreement|extradition|prisoner\s+(swap|exchange)|hostage|diplomatic\s+immunity)\b/i,
  ]),

  // ── Legal ───────────────────────────────────────────────
  rule('legal/lawsuits', 'Lawsuits', 'Legal', [
    /\b(lawsuit|class\s+action|litigation|settle(ment)?|plaintiff|defendant|court\s+(ruling|decision|order|case)|judge\s+(ruling|decision|order)|verdict|jury\s+(verdict|trial|deliberation)|damages\s+(awarded|claimed)|appeal(s)?\s+(court|ruling)|injunction|subpoena)\b/i,
  ]),
  rule('legal/criminal', 'Criminal', 'Legal', [
    /\b(indictment|arraignment|criminal\s+(charge|trial|case|investigation)|conviction|acquittal|sentencing|plea\s+(deal|bargain|guilty)|guilty\s+verdict|not\s+guilty|prison\s+sentence|pardon|extradition\s+request|fraud\s+(charge|trial|case)|money\s+laundering|racketeering|conspiracy\s+(charge|trial))\b/i,
  ]),
  rule('legal/regulatory-actions', 'Regulatory Actions', 'Legal', [
    /\b(enforcement\s+action|consent\s+order|cease\s+and\s+desist|fine(d)?\s+\$|penalty|regulatory\s+(fine|action|crackdown|probe)|investigation\s+into|probe\s+into|compliance\s+violation|consent\s+decree|deferred\s+prosecution)\b/i,
  ]),

  // ── Weather ─────────────────────────────────────────────
  rule('weather/temperature', 'Temperature', 'Weather', [
    /\b(temperature\s+(record|high|low|forecast|average)|heat\s+wave|cold\s+(snap|wave|front)|frost|freeze\s+warning|windchill|hottest\s+(day|month|year|on\s+record)|coldest\s+(day|month|year)|degree(s)?\s+(fahrenheit|celsius|above|below))\b/i,
  ]),
  rule('weather/storms', 'Storms', 'Weather', [
    /\b(hurricane|tropical\s+(storm|cyclone|depression)|typhoon|cyclone|tornado|thunderstorm|blizzard|ice\s+storm|nor'?easter|storm\s+(surge|damage|warning|watch|track)|category\s+[1-5]|landfall|eye\s+wall|wind\s+speed)\b/i,
  ]),
  rule('weather/seasonal', 'Seasonal', 'Weather', [
    /\b(el\s+ni[ñn]o|la\s+ni[ñn]a|monsoon|rainy\s+season|dry\s+season|snowfall\s+(total|record|season)|winter\s+(storm|forecast|outlook)|spring\s+forecast|summer\s+(forecast|outlook|heat)|fall\s+forecast|polar\s+vortex|aurora|northern\s+lights|white\s+christmas)\b/i,
  ]),

  // ── Pop Culture ─────────────────────────────────────────
  rule('pop-culture/social-media', 'Social Media', 'Pop Culture', [
    /\b(twitter|x\s+(platform|app)|tiktok|instagram|youtube|reddit|twitch|threads\s+(app|meta)|snapchat|social\s+media\s+(ban|regulation|trend)|viral\s+(video|post|tweet|tiktok)|influencer|creator\s+economy|follower(s)?\s+count|subscriber(s)?\s+count|going\s+viral|trending\s+(topic|hashtag))\b/i,
  ]),
  rule('pop-culture/viral', 'Viral & Trends', 'Pop Culture', [
    /\b(meme\s+(coin|stock|trend)|trend(ing)?|viral\s+(moment|challenge)|internet\s+(culture|drama|beef)|drama\s+between|beef\s+between|streamer\s+(drama|ban)|youtube\s+(drama|beef)|influencer\s+(drama|scandal|controversy))\b/i,
  ]),
  rule('pop-culture/personalities', 'Personalities', 'Pop Culture', [
    /\b(elon\s+musk|musk\s+(tweet|post|statement|company)|jeff\s+bezos|mark\s+zuckerberg|zuck|bill\s+gates|warren\s+buffett|sam\s+altman|jensen\s+huang|tim\s+cook|satya\s+nadella|jack\s+dorsey|mr\.?\s+beast|mrbeast|joe\s+rogan|logan\s+paul|ksi|andrew\s+tate)\b/i,
  ]),
];

// ─── Public API ─────────────────────────────────────────────

/**
 * Classify an event into categories. Returns a sorted, deduplicated array
 * of slug strings containing both parent and child entries.
 * Returns [] if nothing matched.
 */
export function classifyEvent(input: ClassifyInput): string[] {
  const corpus = [
    input.title,
    input.description ?? '',
    input.gammaCategory ?? '',
    ...(input.gammaTags ?? []),
  ].join(' ');

  const matched = new Set<string>();

  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(corpus)) {
        matched.add(rule.slug);
        matched.add(rule.parent);
        break; // one pattern match is enough per rule
      }
    }
  }

  return Array.from(matched).sort();
}

/**
 * Returns the full category tree grouped by parent.
 */
export function getAllCategories(): CategoryNode[] {
  const parentMap = new Map<string, CategoryNode>();

  for (const rule of CATEGORY_RULES) {
    let node = parentMap.get(rule.parent);
    if (!node) {
      node = { slug: rule.parent, label: rule.parentLabel, children: [] };
      parentMap.set(rule.parent, node);
    }
    node.children.push({ slug: rule.slug, label: rule.label });
  }

  return Array.from(parentMap.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Look up a label for any slug (parent or child).
 */
export function getCategoryLabel(slug: string): string | undefined {
  // Check parents first
  for (const rule of CATEGORY_RULES) {
    if (rule.parent === slug) return rule.parentLabel;
    if (rule.slug === slug) return rule.label;
  }
  return undefined;
}

/**
 * Returns just the top-level parent categories with labels.
 */
export function getParentCategories(): { slug: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const rule of CATEGORY_RULES) {
    if (!seen.has(rule.parent)) {
      seen.set(rule.parent, rule.parentLabel);
    }
  }
  return Array.from(seen, ([slug, label]) => ({ slug, label })).sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );
}
