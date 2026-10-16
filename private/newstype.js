// What a headline is about, by rules on its words (2026-10-16, the owner,
// after looking at TradingView's news broken down by type: "rules only for
// the time being, AI later"). The headline is all the feed gives us (Google
// News RSS carries no category), so this reads the headline alone.
//
// RULES, NOT A MODEL: free, instant, the same answer every time, and a
// reader can be told exactly why a headline landed where it did. Worked out
// when a headline is DRAWN, not stored, so a better rule re-sorts every stored
// headline at once and nothing needs migrating. An AI pass for what the rules
// cannot place is in docs/backlog.md.
//
// ORDER MATTERS: the first rule that matches decides. Analyst ratings come
// before Market moves, so "shares fall after downgrade" is a rating; Earnings
// before Guidance, so a results headline that mentions the outlook stays a
// results headline. Nothing matched is Other, never a guess.
//
// DISPLAY ONLY. Nothing here feeds the Signal or any score.
(function (root) {
  'use strict';

  const TYPES = [
    ['earnings', 'Earnings'],
    ['ratings', 'Analyst ratings'],
    ['guidance', 'Guidance'],
    ['capital', 'Dividends and buybacks'],
    ['deals', 'Deals'],
    ['leadership', 'Leadership and jobs'],
    ['legal', 'Legal and regulatory'],
    ['products', 'Products and partnerships'],
    // Two the first list did not have, added when real headlines were sorted
    // (2026-10-16): opinion pieces were the largest group left in Other, and
    // institutional holding notices a steady one.
    ['ownership', 'Ownership'],
    ['commentary', 'Commentary'],
    ['moves', 'Market moves'],
    ['other', 'Other'],
  ];
  // Research desks whose name in a headline, beside a verb of judgement, makes
  // it an analyst view ("UBS says", "Wedbush sees"). A firm that is the
  // SUBJECT of a headline ("JPMorgan profit rises") does not match, because
  // the verb list is about opinions, not results.
  const DESKS = 'morgan stanley|goldman( sachs)?|jpmorgan|j\\.p\\. morgan|ubs|barclays|citi(group)?|wedbush|jefferies|bernstein|bofa|bank of america|wells fargo|piper sandler|needham|keybanc|mizuho|evercore( isi)?|raymond james|truist|oppenheimer|deutsche bank|hsbc|loop capital|rosenblatt|td cowen|baird|stifel|cantor( fitzgerald)?|benchmark|bmo|rbc|scotiabank|macquarie|melius|daiwa|nomura|morningstar|argus';
  const DESK_VIEW = new RegExp('\\b(' + DESKS + ')\\b.{0,40}\\b(says?|sees?|expects?|likes?|bullish|bearish|(raises?|lifts?|boosts?|cuts?|trims?|slashes|lowers?|hikes?) (its |the )?(price[- ])?(target|pt|rating|estimates?)|calls?|picks?|top pick|thinks?)\\b', 'i');
  const LABEL = Object.fromEntries(TYPES);

  const RULES = [
    ['ratings', /\b(upgrade[sd]?|downgrade[sd]?|price[- ]target|price objective|target price|initiat\w* (coverage|at)|coverage initiated|reiterat\w*|maintains? (buy|sell|hold|neutral|outperform|overweight)|outperform|underperform|overweight|underweight|equal[- ]weight|market perform|sector perform|analysts? (say|says|see|sees|expect|bullish|bearish|weigh)|wall street analysts|rating on)\b/i],
    ['earnings', /\b(earnings|eps\b|quarterly (results|profit|revenue|loss)|q[1-4] (results|earnings|revenue|profit|sales)|(first|second|third|fourth)[- ]quarter (results|profit|earnings|revenue|sales|loss)|(beats?|miss(es)?|tops?|top|misses) (estimates|expectations|forecasts|views|consensus)|results (beat|miss|top)|profit (rises|falls|jumps|drops|surges|plunges|climbs|slips|soars|beats|misses)|revenue (rises|falls|jumps|drops|surges|grows|climbs|slips|beats|misses|tops)|reports? (results|earnings)|earnings call|conference call|to report|(first|second|third|fourth)[- ]quarter( 20\d\d)? (results|financial results)|announces .{0,40}results|(missing|beating|topping|misses|beats|tops) (analyst |wall street |street )?(estimates|expectations|forecasts)|analyst estimates|a share in the (first|second|third|fourth) quarter)\b/i],
    ['guidance', /\b(guidance|outlook|forecasts? (higher|lower|weak|strong|above|below)|raises? (its )?(full[- ]year|annual|fy|forecast|outlook|guidance)|cuts? (its )?(full[- ]year|annual|fy|forecast|outlook|guidance)|lowers? (its )?(forecast|outlook|guidance)|reaffirms?|sees (fy|full[- ]year|q[1-4]))\b/i],
    ['capital', /\b(dividends?|buybacks?|share repurchase|repurchase (program|plan)|stock split|share split|special payout|payout ratio|ex-dividend|yield hike)\b/i],
    // A fund or adviser filing that it bought, sold or holds shares: the
    // notices generated from 13F filings ("Apple stock sold by Investors
    // Research Corp", "position raised by ...").
    ['ownership', /\b((stake|position|shares|holdings?) (in .{1,40} )?(raised|lowered|increased|decreased|trimmed|boosted|cut|reduced|lifted|grown) by|(stock|shares) (sold|bought|acquired|purchased) by|(acquires|purchases|buys|sells) (new )?(stake|position|shares) in|13f|institutional (investors?|ownership)|hedge funds? (buy|sell|own|are)|(increases|decreases|raises|lowers|trims|boosts|cuts|reduces|grows|lifts) (its |their )?(stake|position|holdings)|(sells|buys|acquires|purchases) [\d,]+ shares of|[\d,]+ shares (acquired|sold|bought|purchased) by|passive stake)\b/i],
    ['deals', /\b(acquires?|acquired|acquisition|acquiring|merger|merge[sd]?|takeover|buyout|agrees? to buy|in talks to buy|deal to buy|to buy .{2,40} for \$|bid for|spin[- ]?off|spins off|divest\w*|sells? (its |a )?(stake|unit|division|business)|takes? (a )?stake)\b/i],
    ['leadership', /\b(new (ceo|cfo|coo|cto|chief executive|chairman|chair)|names? .{0,40}(ceo|cfo|coo|cto|chief executive|chairman|president)|(ceo|cfo|coo|cto|chief executive|chairman) (to )?(step|steps|stepping) down|(ceo|cfo|coo|cto|chief executive|chairman) (exits|departs|leaves|out|ousted|fired)|steps? down|resigns?|resignation|retires?|appoints?|appointed|names? new|succession|successor|hires? (a |new )?(chief|head|president)|executive shake[- ]?up|layoffs?|job cuts|cuts? ([\d,]+ )?(jobs|workforce|staff|positions))\b/i],
    ['legal', /\b(lawsuit|sues|sued|suing|class action|settle(s|d|ment)?|probe|investigation|investigat\w+|subpoena|antitrust|regulators?|regulatory|sec (charges|probe|fine|investigation)|ftc|doj|justice department|european commission|eu (fine|probe|regulators?)|court|judge|ruling|verdict|fined?|penalty|recall|ban(s|ned)?|sanction\w*|patent (suit|case|dispute|infringement))\b/i],
    ['products', /\b(launch\w*|unveil\w*|introduc\w*|debuts?|rolls? out|rolling out|releases? (new|its)|new (product|model|chip|feature|service|platform)|partner\w*|collaborat\w*|teams? up|joins? forces|contract|signs? (a |an )?(deal|agreement)|agreement with|deal with|wins? (a )?(contract|order|deal)|order from|supply deal|approval for|fda (approves|approval|clears)|approved by)\b/i],
    // Opinion and outlook pieces: questions, predictions, "worth by 2030",
    // listicles. Ahead of Market moves, so "should a new high stop you
    // buying?" is commentary, not a price move.
    ['commentary', /(\?\s*$|\b(should you|is it time|time to (buy|sell)|buy (now|today|before|after|and hold|the dip)|stocks? to (buy|watch|own|hold)|worth (in|by) \d|could (be worth|double|triple|soar|make|turn)|prediction|predictions|in \d+ years|by 20\d\d|bull case|bear case|the case (for|against)|here'?s (why|what|how)|what (it|this) means|better buy|top (pick|stocks|ai stocks)|my (top|favorite)|i'?d (still )?(buy|sell)|i would|i'?m (buying|selling)|millionaire|forever|history says|undervalued|overvalued|bubble|investors should|things to know|what to expect|facts to know|alert:|warns?|lessons?|explained|deep dive|opinion|ma(y|ight) be|could (benefit|be|face|see|gain|lose|rise|fall|climb|drop|hit|reach)|biggest risks?|risks? (to|for|facing)|narrative|matters? more|would have made|here'?s how much|forecast:|mark your calendars?|safe haven|faces rising|what wall street)\b)/i],
    ['moves', /\b((shares?|stock|stocks|share price) (rise|rises|rose|fall|falls|fell|jump|jumps|jumped|drop|drops|dropped|surge|surges|surged|surging|plunge|plunges|plunged|slide|slides|slid|soar|soars|soared|soaring|climb|climbs|climbed|tumble|tumbles|tumbled|sink|sinks|sank|sinking|rally|rallies|rallied|gain|gains|gained|slump|slumps|slumped|slips?|dips?|edges? (up|down|higher|lower)|moves? (higher|lower|up|down)|notches up|is (up|down|rising|falling|higher|lower)|are (up|down)|trading (higher|lower)|bleed\w*|lower|higher)|surging share price|why .{1,60} (stock|shares) (is|are|was|were) (up|down|rising|falling|soaring|sinking|plunging|jumping|moving)|(all[- ]time|record|52[- ]week) (highs?|lows?|close)|hits? (a )?new record|(face|faces|under) (renewed )?(selling )?pressure|most valuable company|record (high|close|territory)|hits? (a )?(record|new high|new low)|premarket|pre-market|after[- ]hours|sell[- ]?off|rout|biggest (moves|movers|gainers|losers)|movers|market (cap|value)|\$\d+(\.\d+)? trillion|(up|down) \d+(\.\d+)?%|\d+(\.\d+)?% (higher|lower|rise|drop|jump|fall|gain|loss|dip)|(sink|sinks|slide|slides|fall|falls|jump|jumps|rise|rises|rally|rallies|tumble|tumbles|bleed\w*|lead\w*) .{0,30}(lower|higher)|losses contribute|(lead|leads|led) .{0,30}(lower|higher|declines|gains))\b/i],
  ];

  // A price move told as "<Company> sinks ..." or "<Company> is down 23%":
  // a capitalised name of up to four words opening the headline, then the
  // verb. Case-sensitive on the name, so "Stocks to buy" is not a company.
  const NAME_MOVE = /^[A-Z][\w&.'-]*( [A-Z][\w&.'-]*){0,3} (sinks|sank|slides|slid|falls|fell|drops|dropped|dips|dipped|jumps|jumped|surges|surged|soars|soared|plunges|plunged|tumbles|tumbled|rallies|rallied|climbs|climbed|slumps|slumped|rebounds|rebounded|extends? (losses|gains|slide|rally))\b/;
  const IS_MOVE = /\b(is|are|was|were) (up|down) \d+(\.\d+)?%/i;

  function classify(headline) {
    const h = String(headline || '');
    if (!h) return 'other';
    for (const [id, re] of RULES) {
      if (re.test(h)) return id;
      // A named research desk with a verb of judgement is an analyst view,
      // tested right after the ratings vocabulary so it keeps that priority.
      if (id === 'ratings' && DESK_VIEW.test(h)) return 'ratings';
      // Name-first moves, checked where Market moves sits in the order.
      if (id === 'moves' && (NAME_MOVE.test(h) || IS_MOVE.test(h))) return 'moves';
    }
    return 'other';
  }

  const api = { TYPES: TYPES.map((t) => t.slice()), LABEL, classify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NewsType = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
