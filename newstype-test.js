// private/newstype.js on headlines of the kind the feed serves, including the
// ones that taught a rule. No network.   node newstype-test.js
const N = require('./private/newstype.js');
let ran = 0, failed = 0;
const want = (h, id) => { ran++; const got = N.classify(h); if (got !== id) { failed++; console.log('FAIL', JSON.stringify(h), 'got', got, 'want', id); } };

// Earnings
want('Microsoft beats quarterly revenue estimates on cloud strength', 'earnings');
want('ExxonMobil Announces Second-Quarter 2026 Results', 'earnings');
want('JPMorgan Chase posted $5.57 a share in the third quarter, missing analyst estimates', 'earnings');
want('Microsoft to report Q1 earnings Tuesday: what to expect', 'earnings');
// Analyst ratings, including a named desk and a price move caused by one
want('Morgan Stanley raises Microsoft price target to $600', 'ratings');
want('Microsoft shares fall after Barclays downgrade', 'ratings');
want('Microsoft can justify higher valuation as AI demand drives Azure growth, UBS says', 'ratings');
want('Apple Stock Scores Price-Target Hike Ahead Of Smart Home Launch', 'ratings');
// A desk that is the SUBJECT of its own news is not an analyst view
want('JPMorgan Chase Raises Full-Year Net Interest Income Outlook', 'guidance');
// Guidance
want('Microsoft raises full-year outlook as AI demand surges', 'guidance');
// Dividends and buybacks
want('Microsoft announces $60 billion share buyback, raises dividend', 'capital');
want('JPMorganChase Declares Preferred Stock Dividends', 'capital');
// Deals, and "to buy" that is not one
want('Microsoft agrees to buy Activision Blizzard for $69 billion', 'deals');
want('A Tesla-SpaceX Merger Could Be Weeks Away', 'deals');
want('3 Stocks to Buy Now Before They Soar', 'commentary');
// Leadership and jobs: a change of people, not any sentence with a CEO in it
want('Microsoft CFO Amy Hood to step down', 'leadership');
want('Supermicro Appoints Mark Long as Chief Financial Officer', 'leadership');
want('Microsoft cuts 6,000 jobs', 'leadership');
want('Nvidia CEO says CoreWeave needs no backstop', 'other');
// Legal and regulatory
want('FTC sues Microsoft over cloud licensing', 'legal');
// Products and partnerships
want('Microsoft unveils new Copilot features for Windows', 'products');
want('OpenAI and Microsoft sign new partnership agreement', 'products');
// Ownership: 13F notices, ahead of Deals even when they say "acquired"
want('Apple Inc. $AAPL Stock Sold by Investors Research Corp', 'ownership');
want('46,177 JPMorgan Chase & Co. $JPM Shares Acquired by West Wealth Group LLC', 'ownership');
want('Apple Inc. $AAPL Stock: Bath Savings Trust Co Increases Stake', 'ownership');
// Commentary, ahead of Market moves
want('Should Microsoft Stock’s New High Stop You From Buying?', 'commentary');
want('Here’s What a $10,000 Investment in Apple Stock Could Be Worth in 5 Years', 'commentary');
// Market moves
want('Why Microsoft stock is down today', 'moves');
want('Microsoft stock hits all-time high', 'moves');
want('Nvidia shares jump 5% premarket', 'moves');
want('Apple Stock May Be Peaking After Hitting New All-Time Highs', 'commentary');
want('Apple retakes $5 trillion market cap, only second company to eclipse milestone number', 'moves');
want('Micron sinks, other memory-linked names dip for a second day', 'moves');
want('Micron Is Down 23% From Its High. History Suggests This Is What Happens Next.', 'moves');
// Nothing to go on
want('Apple’s New ‘Home’ Run (NASDAQ:AAPL)', 'other');
want('', 'other');
want(null, 'other');

// The catalogue
ran++; if (N.TYPES[N.TYPES.length - 1][0] !== 'other') { failed++; console.log('FAIL Other is not last'); }
ran++; if (new Set(N.TYPES.map((t) => t[0])).size !== N.TYPES.length) { failed++; console.log('FAIL duplicate type'); }
ran++; if (!N.TYPES.every((t) => N.LABEL[t[0]] === t[1])) { failed++; console.log('FAIL LABEL out of step'); }

console.log(ran + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
