// The idea behind each opening, for its page: what the whole opening is about for both sides, its main
// variations with their first moves, and the thing to watch out for. Editorial, from standard opening
// theory; keyed by the Lichess family name, like ABOUT in styles.js. Written from neither side, so it
// reads the same whether you play the opening or face it.
export const GUIDE = {
  // ---------- 1.e4 e5 ----------
  'Italian Game': {
    idea: 'White puts the bishop on c4, aimed at f7, the square only Black\'s king defends. The game turns on the centre: White wants d4 with c3 behind it, Black wants to hold e5 and break with ...d5. Slow set-ups with d3 give a long manoeuvring game; fast ones with d4 open lines at once.',
    lines: [['Giuoco Pianissimo', '3...Bc5 4.c3 Nf6 5.d3: quiet build-up, both sides castle and manoeuvre.'], ['Evans Gambit', '4.b4: White gives a pawn to gain time for c3 and d4 and a fast attack.'], ['Two Knights Defense', '3...Nf6: Black counter-attacks e4; 4.Ng5 hits f7 and leads to sharp play after 4...d5.'], ['Fried Liver', '4.Ng5 d5 5.exd5 Nxd5? 6.Nxf7: White sacrifices a knight to drag the king out.']],
    watch: 'Both sides must watch f7 and f2: Ng5 or ...Ng4 with the bishop behind it is the classic trick.',
  },
  'Ruy Lopez': {
    idea: 'White\'s bishop pins down the knight that defends e5, so pressure on e5 builds over many moves. Black usually kicks the bishop with ...a6 and ...b5 and keeps e5 with ...d6. It is a long strategic fight: White aims for d4 and a kingside attack, Black for queenside space and ...d5.',
    lines: [['Morphy Defense', '3...a6 4.Ba4 Nf6 5.O-O Be7: the main road, slow and rich.'], ['Berlin Defense', '3...Nf6 4.O-O Nxe4: Black trades queens early into a solid endgame.'], ['Exchange Variation', '4.Bxc6 dxc6: White gives the bishop pair for a better pawn structure.'], ['Marshall Attack', '...O-O and ...d5: Black gives a pawn for a fierce kingside attack.']],
    watch: 'Taking on e5 too early (Bxc6 and Nxe5) often fails to ...Qd4 or ...Qg5 hitting the knight and e4.',
  },
  'Scotch Game': {
    idea: 'White opens the centre at once with d4, trades the e5 pawn and gets free piece play and space. Black gets easy development in return and aims at the knight on d4 and the e4 pawn. Open, tactical positions with few long plans.',
    lines: [['Classical', '4...Bc5: Black develops with pressure on d4.'], ['Mieses', '4...Nf6 5.Nxc6 bxc6 6.e5: White chases the knight and gets space.'], ['Scotch Gambit', '4.Bc4: White skips Nxd4 for fast development.']],
    watch: 'After ...Qh4 Black hits e4 and f2 at once; White must defend accurately.',
  },
  'Vienna Game': {
    idea: 'White develops the queen\'s knight first to support f4, a King\'s Gambit with better preparation. Black can hit back in the centre with ...d5 or develop quietly. Sharp play on the kingside and the f-file.',
    lines: [['Vienna Gambit', '3.f4: White opens the f-file; Black\'s best is the counter-strike 3...d5.'], ['Frankenstein-Dracula', '3.Bc4 Nxe4 4.Qh5: wild tactics around f7 and e5.'], ['Max Lange Defense', '2...Nc6: Black keeps e5 solid before choosing a plan.']],
    watch: 'Black must not ignore f4: the open f-file and f7 come under fire fast.',
  },
  "King's Gambit": {
    idea: 'White gives the f-pawn to deflect e5, build a big centre with d4 and open the f-file against f7. Black can keep the pawn and develop, or give it back for a lead in development. Every tempo counts, and both kings are often exposed.',
    lines: [['Accepted: Kieseritzky', '3.Nf3 g5 4.h4: White hits Black\'s pawn chain at once.'], ['Accepted: Fischer Defense', '3.Nf3 d6: Black keeps the pawn with a calm move.'], ['Declined: Classical', '2...Bc5: the bishop stops White castling short for a while.'], ['Falkbeer Counter-Gambit', '2...d5: Black answers with a gambit in the centre.']],
    watch: 'Qh4+ against the open king is Black\'s main trick; White must watch the e1-h4 diagonal.',
  },
  'Danish Gambit': {
    idea: 'Time over material: White gives one or two pawns so every piece gets into play before Black is developed. The targets are f7 (the bishop on c4, later the queen on b3, which also hits b7) and, after the second pawn, the long diagonal to g7 with a bishop on b2. Black\'s best answer is to give a pawn back with ...d5 at the right moment and finish developing; if Black just grabs, the attack usually crashes through.',
    lines: [['Two-pawn gambit', '3...dxc3 4.Bc4 cxb2 5.Bxb2: both bishops rake the board; Qb3 hits f7 and b7 at once.'], ['Schlechter Defense', '5...d5!: Black returns a pawn, trades on f7 and d8 and reaches an equal endgame. The main reason strong players avoid the two-pawn line.'], ['Modern Danish', '4.Nxc3: White takes one pawn back, keeps the e4 pawn and plays Bc4, Nf3, Qb3, castles and puts the rooks on c1 and d1. Calmer, and there is no easy ...d5 equaliser.'], ['Declined', '3...d5 (Sørensen) 4.exd5 Qxd5 5.cxd4: White gets a normal game with the centre; 3...d6 or 3...Qe7 are slower.']],
    watch: 'Greedy Black gets mated: Bxf7+ followed by Ng5+, Qh5+ or Qb3 is the pattern; and ...Qg5 grabbing g2 runs into Rg1 and Bxf7+.',
  },
  "Bishop's Opening": {
    idea: 'White develops the bishop to c4 first and keeps the knight and the f-pawn flexible, often heading for a Vienna or an Italian with f4 in reserve. Black usually hits e4 with ...Nf6. Few forcing lines, many chances to transpose.',
    lines: [['Berlin Defense', '2...Nf6 3.d3: White keeps everything solid and plays for f4 later.'], ['Urusov Gambit', '2...Nf6 3.d4: White gives a pawn for quick activity.'], ['Classical', '2...Bc5: both bishops face the weak squares f2 and f7.']],
    watch: 'Qh5 ideas against f7 come up early; Black should defend f7 before grabbing e4.',
  },
  'Four Knights Game': {
    idea: 'Both sides bring out both knights before anything else, a symmetrical and solid start. The fight is about who frees the game first with d4 or ...d5. Small edges and long games.',
    lines: [['Spanish', '4.Bb5: White pins and prepares d4.'], ['Scotch', '4.d4: White opens the centre at once.'], ['Halloween Gambit', '4.Nxe5?!: a knight sacrifice for a big pawn centre.']],
    watch: 'Symmetry can turn: the side that copies too long often gets hit by a pin on the knight.',
  },
  'Three Knights Opening': {
    idea: 'White develops both knights and keeps the bishops flexible, waiting for Black to choose. It often turns into a Four Knights or a Scotch. A safe, piece-first opening with no forcing lines.',
    lines: [['Into the Four Knights', '3...Nf6: the most common answer.'], ['Steinitz Defense', '3...g6: Black fianchettoes and plays slowly.']],
    watch: 'Black\'s centre on e5 can be hit fast with d4; Black should develop before going for ...d5.',
  },
  'Ponziani Opening': {
    idea: 'White plays c3 to prepare d4 and a full pawn centre. It costs a tempo, so Black can strike at once with ...d5 or ...Nf6 at e4. Old and rare, with lots of tactics in the centre.',
    lines: [['Jaenisch Counter-Attack', '3...Nf6 4.d4 Nxe4: Black hits the centre right away.'], ['Leonhardt Variation', '3...d5 4.Qa4: White pins the knight and keeps the pressure.']],
    watch: 'After ...d5 the e4 pawn and the knight on c6 can both be hanging; tactics come fast.',
  },
  'Center Game': {
    idea: 'White opens the centre at once and takes back with the queen. It costs a tempo when ...Nc6 chases it, but White gets the half-open d-file, quick development and a clear plan: Qe3 (stopping ...d5, ready for Qg3 against g7), Nc3, Bd2, castle long, then push the kingside pawns. Think of it as a Scandinavian with the colours reversed and an extra pawn traded.',
    lines: [['Paulsen Attack', '4.Qe3 Nf6 5.Nc3 Bb4 6.Bd2 O-O 7.O-O-O Re8: opposite castling and a race.'], ['Three tries', 'From there 8.Qg3 (giving e4 for play), 8.Qf4 with f3 and g4, or 8.Bc4.'], ['Black\'s solid set-ups', '4...Be7 with ...d5 soon, or 4...g6 and 4...Bb4+: fine for Black, so no free attack.']],
    watch: 'With castling on opposite wings, every tempo counts: the side whose pawns arrive first usually wins.',
  },
  "Petrov's Defense": {
    idea: 'Black attacks e4 instead of defending e5, giving a symmetrical, solid game. After the pawns are traded, both sides develop and the side that uses the e-file better gets the edge. Hard for White to break.',
    lines: [['Classical', '3.Nxe5 d6 4.Nf3 Nxe4: the main symmetrical line.'], ['Steinitz', '3.d4: White opens the centre at once.']],
    watch: 'Copying with 3...Nxe4? at once loses to 4.Qe2: the queen pins the knight to the king.',
  },
  'Philidor Defense': {
    idea: 'Black defends e5 with the pawn on d6 instead of a knight, for a solid set-up with a clear plan and little theory. The downsides are a cramped bishop on f8, which waits on e7, and a slightly better centre for White. After 3.d4 Black chooses: give up the centre with ...exd4 for quiet piece play, or hold e5 with ...Nd7, ...Ngf6, ...Be7 and ...c6.',
    lines: [['Exchange (Antoshin)', '3.d4 exd4 4.Nxd4 Nf6 5.Nc3 Be7: calm, positional play.'], ['Hanham / Lion set-up', '...Nd7, ...Ngf6, ...Be7, ...c6: Black keeps e5 and often expands later.'], ['Main 3.d4 test', 'White hits the centre at once and forces Black to decide.']],
    watch: 'Move order matters: an early Bc4 with Ng5 or Bxf7+ punishes careless development against f7.',
  },
  'Elephant Gambit': {
    idea: 'Black answers 2.Nf3 with 2...d5, a gambit that opens the centre at once. If White plays accurately Black is just a pawn down, but against an unprepared opponent the open lines give quick play.',
    lines: [['Main line', '3.exd5 e4: Black gains space and hunts the knight.']],
    watch: 'Black\'s king gets exposed if the attack stalls.',
  },
  'Latvian Gambit': {
    idea: 'Black plays ...f5 on move two, a wild King\'s Gambit with colours reversed and a tempo less. It leads to chaos around both kings. Objectively dubious but full of traps.',
    lines: [['Main line', '3.Nxe5 Qf6: Black attacks the knight and plans ...fxe4.']],
    watch: 'Black\'s king is weak after ...f5; checks on h5 and the e-file come quickly.',
  },
  // ---------- 1.e4, other ----------
  'Sicilian Defense': {
    idea: 'Black fights for d4 with the c-pawn instead of the e-pawn, so the game is unbalanced from move one. After d4 and cxd4 White gets space and quick development, Black gets the half-open c-file and a central pawn majority. White often attacks the king, Black counter-attacks on the queenside.',
    lines: [['Najdorf', '5...a6: the most flexible and deeply analysed main line.'], ['Dragon', '5...g6: bishop on the long diagonal; White often castles long and storms.'], ['Alapin', '2.c3: White prepares d4 with a pawn and avoids the main lines.'], ['Smith-Morra Gambit', '2.d4 cxd4 3.c3: White gives a pawn for development.']],
    watch: 'In the open lines White\'s attack can be very fast; Black must not fall behind in development.',
  },
  'French Defense': {
    idea: 'Black plays ...e6 so that ...d5 can be taken back with a pawn, not the queen. The price is the light bishop on c8, shut in behind e6: freeing or trading it is Black\'s lasting task. White usually takes space with e5; Black then attacks the d4-e5 chain from the side with ...c5 (and later ...f6), so d4 becomes the key square. Played actively, it is a counter-attacking opening, not a passive one.',
    lines: [['Exchange', '3.exd5 exd5: the most common at club level and harmless; Black frees the c8 bishop and can even castle long and push the kingside pawns.'], ['Advance', '3.e5 c5 4.c3: Black hits d4 with ...Nc6, ...Qb6 and ...Nge7-f5; or ...Bd7-b5 to trade the problem bishop.'], ['Winawer', '3.Nc3 Bb4: Black pins and doubles White\'s pawns, but the dark squares round the king get weak; Qg4 against g7 is White\'s idea.'], ['Classical and Rubinstein', '3.Nc3 Nf6 (4.e5 Nfd7 or 4.Bg5), or 3...dxe4 with ...Nd7, ...Ngf6 and ...c5.']],
    watch: 'Black must not just sit: without ...c5 against d4, White\'s space and a Bxh7+ sacrifice can decide quickly.',
  },
  'Caro-Kann Defense': {
    idea: 'Black prepares ...d5 with ...c6, so the light bishop can come out before ...e6 shuts it in. Black gets a very solid structure with few weaknesses; White usually gets more space and plays for a slow edge or a kingside push.',
    lines: [['Advance', '3.e5 Bf5: White gains space; Black develops the bishop first.'], ['Classical', '3.Nc3 dxe4 4.Nxe4 Bf5: solid and well tested.'], ['Exchange', '3.exd5 cxd5: symmetrical, with easy plans for both.'], ['Two Knights', '2.Nc3 and 3.Nf3: White keeps options open.']],
    watch: 'After the advance, Black\'s bishop can get trapped by g4 and h4 if it stays on the kingside.',
  },
  'Scandinavian Defense': {
    idea: 'Black takes on e4 at once with ...d5, getting a clear position with no theory to fear. The price is time: the queen comes out and gets chased by Nc3. Black then sets up with ...c6, ...Bf5 and ...e6, a Caro-Kann-like structure.',
    lines: [['Main line', '2...Qxd5 3.Nc3 Qa5: the queen sits safe on a5.'], ['Modern', '2...Nf6: Black takes back with the knight later.'], ['Icelandic Gambit', '2...Nf6 3.c4 e6: Black gives a pawn for quick development.']],
    watch: 'The black queen must not get trapped or chased too often; each tempo matters.',
  },
  'Alekhine Defense': {
    idea: 'Black attacks e4 with the knight and lets White chase it with pawns, so White gets a big centre. Black then attacks that over-extended centre with ...d6, ...Bf5 or ...g6. If the centre holds White is better; if it cracks, Black is.',
    lines: [['Four Pawns Attack', 'e5, c4, d4 and f4: the most ambitious, and the riskiest.'], ['Modern', '4.Nf3: White keeps the centre and develops calmly.'], ['Exchange', '5.exd6: White trades the advanced pawn for a simple game.']],
    watch: 'White must not over-extend: every pawn push leaves squares behind it.',
  },
  'Pirc Defense': {
    idea: 'Black lets White build a big centre with d4 and e4, develops behind ...d6, ...Nf6 and ...g6, castles, and strikes back with ...e5 or ...c5. White often attacks with f4 or castles long and pushes h4.',
    lines: [['Austrian Attack', '4.f4: White builds the biggest centre and attacks.'], ['Classical', '4.Nf3: a calm, solid set-up.'], ['150 Attack', 'Be3, Qd2 and Bh6: White trades the fianchetto bishop and attacks.']],
    watch: 'If Black waits too long, e5 and a kingside attack can come before any counterplay.',
  },
  'Modern Defense': {
    idea: 'Black puts the bishop on g7 at once and delays ...Nf6, staying very flexible. White gets the centre; Black hits it later with ...c5, ...e5 or ...d5. Hard to prepare against, but Black needs to know when to strike.',
    lines: [['Standard', '2.d4 d6 3.Nc3: White builds the classic centre.'], ['Pterodactyl', '...c5 and ...Qa5: Black attacks the centre from the queenside.']],
    watch: 'White\'s centre can roll forward if Black is too slow to challenge it.',
  },
  'Nimzowitsch Defense': {
    idea: 'Black plays 1...Nc6 and lets White choose the centre, then attacks it with pieces and ...d5 or ...e5. Offbeat and light on theory.',
    lines: [['Main line', '2.d4 d5: Black hits the centre at once.'], ['Williams', '2.Nf3 d6: Black plays it like a Pirc.']],
    watch: 'The knight on c6 blocks the c-pawn, so Black has fewer pawn breaks than usual.',
  },
  'Owen Defense': {
    idea: 'Black fianchettoes the queen\'s bishop at once to pressure e4 from b7. White takes the centre and often aims Bd3 at h7. Offbeat and rarely seen.',
    lines: [['Main line', '2.d4 Bb7 3.Bd3: White defends e4 and points at the kingside.']],
    watch: 'The a8-h1 diagonal is Black\'s strength, but the kingside is light on defenders.',
  },
  'Wayward Queen Attack': {
    idea: 'White brings the queen out early to hit f7 and e5 at once, hoping for Scholar\'s Mate tricks. With accurate defence Black gains time chasing the queen and gets the better game.',
    lines: [['Main line', '2.Qh5 Nc6 3.Bc4 g6: Black defends f7 and attacks the queen.']],
    watch: 'Black must defend f7 before anything else; after that, every move that hits the queen gains time.',
  },
  // ---------- 1.d4 ----------
  "Queen's Gambit": {
    idea: 'White offers the c-pawn to lure Black\'s d5 pawn away from the centre. Black can take it (Accepted) and give it back for easy development, or keep d5 with ...e6 or ...c6 (Declined, Slav). A classical fight over the centre and the c-file.',
    lines: [['Declined', '2...e6: the most classical, solid answer.'], ['Accepted', '2...dxc4: Black takes and gives it back later.'], ['Slav', '2...c6: Black keeps d5 and the light bishop free.'], ['Albin Counter-Gambit', '2...e5: Black answers with a gambit of their own.']],
    watch: 'In the Accepted, holding on to the c4 pawn with ...b5 usually backfires.',
  },
  "Queen's Gambit Declined": {
    idea: 'Black holds d5 with ...e6, the most solid answer. White pressures d5 and develops; Black frees the game later with ...c5 or ...e5. The light bishop is Black\'s main problem piece.',
    lines: [['Orthodox', '...Be7, ...O-O and ...Nbd7: the classic set-up.'], ['Exchange', 'cxd5 exd5: White plays the minority attack with b4-b5.'], ['Tarrasch', '3...c5: Black accepts an isolated pawn for activity.']],
    watch: 'Nxd5? tricks fail when the knight on d5 is pinned; know the Elephant trap.',
  },
  "Queen's Gambit Accepted": {
    idea: 'Black takes the c4 pawn, giving up the centre for a while, then gives the pawn back for free development and ...c5. White gets the centre and active pieces; Black gets a clear, sound position.',
    lines: [['Main line', '3.Nf3 Nf6 4.e3 e6 5.Bxc4 c5: classical and solid.'], ['Central', '3.e4: White takes the whole centre at once.']],
    watch: 'Trying to keep the pawn with ...b5 loses to a4 and Qf3 tricks.',
  },
  'Slav Defense': {
    idea: 'Black supports d5 with ...c6 so the light bishop can come out to f5 or g4 before ...e6. Very solid, with a sound pawn structure. White tries to prove that ...c6 cost time.',
    lines: [['Main line', '4...dxc4: Black takes and then plays ...Bf5.'], ['Exchange', 'cxd5 cxd5: symmetrical and drawish.'], ['Chebanenko', '4...a6: Black prepares ...b5.']],
    watch: 'After ...Bf5 the b7 pawn can be weak: Qb3 hits it.',
  },
  'Semi-Slav Defense': {
    idea: 'Black combines ...c6 and ...e6 for a double support of d5. The light bishop stays at home, but the structure is very sound. The main lines (Meran, Botvinnik) are among the sharpest in chess.',
    lines: [['Meran', '...dxc4 and ...b5: Black grabs queenside space.'], ['Botvinnik', '5.Bg5 dxc4: wild, double-edged play.']],
    watch: 'Long theory in the main lines; know where your pieces go.',
  },
  'London System': {
    idea: 'White sets up d4, Bf4, e3, Nf3, c3, Nbd2 and Bd3 against almost anything, a solid triangle around the centre. The plans repeat: castle, then push e4 or attack on the kingside with Ne5 and Qf3 or h4. Black usually hits d4 with ...c5 and b2 with ...Qb6.',
    lines: [['Classical', 'Against ...d5 and ...Nf6: the standard set-up.'], ['Jobava', 'With Nc3: a sharper version aiming at c7 and e4.']],
    watch: '...Qb6 hitting b2 is Black\'s main idea; White must answer it with Qb3 or Qc1.',
  },
  'Colle System': {
    idea: 'White builds d4, e3, Bd3, Nbd2 and castles, then pushes e4 to open the centre and attack h7. A fixed plan that works against most set-ups.',
    lines: [['Colle-Koltanowski', 'e4 after full development: the classic plan.'], ['Colle-Zukertort', 'b3 and Bb2: the bishop joins the attack from the long diagonal.']],
    watch: 'The bishop on c1 stays shut in; free it or the plan slows down.',
  },
  'Trompowsky Attack': {
    idea: 'White plays Bg5 against ...Nf6 at once, threatening to double Black\'s pawns. It avoids most theory and gives unbalanced games where the bishop pair often goes for structure.',
    lines: [['Main line', '2...Ne4: Black hits the bishop back.'], ['Classical', '2...e6: Black keeps the structure and develops.']],
    watch: 'After Bxf6 Black gets the bishop pair; White must use the time.',
  },
  'Stonewall Attack': {
    idea: 'White sets pawns on d4, e3 and f4 and the bishop on d3, then sends the pieces after the king: Ne5, Qf3, Rf3-h3 or g4. A clear attacking plan, but the e4 square is a hole Black can use.',
    lines: [['Main line', 'Bd3, f4, Nf3 and Ne5: the standard build-up.']],
    watch: 'Black\'s knight on e4 is strong; ...c5 and queenside play counter the attack.',
  },
  'Blackmar-Diemer Gambit': {
    idea: 'White gives a pawn with e4 and f3 to open the f-file and develop fast against the black king. All-in aggression: if the attack stalls, White is just a pawn down.',
    lines: [['Main line', '3...dxe4 4.f3 exf3 5.Nxf3: White develops at full speed.'], ['Declined', 'Black keeps the pawn on e4 or refuses the gambit.']],
    watch: 'Black should not grab more: return material to finish development.',
  },
  'Rapport-Jobava System': {
    idea: 'A sharper London: Nc3 and Bf4, aiming Nb5 at c7 and pushing e4 when possible. White often castles long and attacks with h4.',
    lines: [['Main line', 'Nb5 against c7: Black must defend at once.']],
    watch: 'Black can hit back fast with ...Bb4 and ...Ne4.',
  },
  "King's Indian Attack": {
    idea: 'White uses the same set-up against everything: Nf3, g3, Bg2, castle, d3, Nbd2 and e4, then e5 and a kingside attack. Simple to learn and plays like a King\'s Indian Defense with an extra tempo.',
    lines: [['Against the French', 'e5 and h4: the classic kingside attack.'], ['Against ...c5', 'A reversed Sicilian with a slower centre.']],
    watch: 'Black\'s queenside push with ...b5 and ...c4 comes fast; White must be quicker.',
  },
  'English Opening': {
    idea: 'White starts with c4 to fight for d5 from the side, keeping the centre pawns flexible. Often a reversed Sicilian. Positional play: queenside space with b4, or e4 and d4 later.',
    lines: [['Reversed Sicilian', '1...e5: Black takes the centre, White plays g3 and Bg2.'], ['Symmetrical', '1...c5: both sides fight for d4 and d5 from the side.'], ['Anglo-Indian', '1...Nf6: transpositions to many d4 openings.']],
    watch: 'Without central pawns White can be pushed around; do not drift.',
  },
  'Réti Opening': {
    idea: 'White starts with Nf3 and c4 to attack Black\'s centre from the side instead of occupying it. Flexible and positional; the fight is about d5.',
    lines: [['Main line', '1...d5 2.c4: White hits the centre pawn at once.']],
    watch: 'Black can grab space with ...d4; White needs a plan against it.',
  },
  'Zukertort Opening': {
    idea: 'White starts with Nf3 and decides later between d4, c4 and a King\'s Indian Attack. The flexibility means Black has to show their hand first.',
    lines: [['Into a Queen\'s Pawn', '2.d4: the most common.'], ['Into the Réti', '2.c4: pressure on d5.']],
    watch: 'Without a plan, flexibility turns into passivity.',
  },
  'Bird Opening': {
    idea: 'White plays f4 to control e5 from the kingside, often with b3 and Bb2. It leads to unbalanced games with chances for a kingside attack, but the king is a little weaker.',
    lines: [['From Gambit', '1...e5: Black gives a pawn to open lines at White\'s king.'], ['Dutch reversed', '1...d5: a Dutch with an extra move for White.']],
    watch: 'The e1-h4 diagonal is weak: ...Qh4+ tricks come early.',
  },
  'Nimzo-Larsen Attack': {
    idea: 'White fianchettoes the queen\'s bishop at once to pressure e5 and the long diagonal. Flexible, with transpositions to the English or the Bird.',
    lines: [['Classical', '1...d5: Black takes the centre.'], ['Modern', '1...e5: Black hits the diagonal with a pawn.']],
    watch: 'Black can take a big centre; White must challenge it with c4 or f4.',
  },
  'Dutch Defense': {
    idea: 'Black plays ...f5 to control e4 from the kingside and later attack there. Unbalanced and ambitious; the king is a little weaker. Set-ups: Stonewall (pawns on d5, e6, f5), Leningrad (...g6) or Classical (...e6, ...d6).',
    lines: [['Leningrad', '...g6 and ...Bg7: a King\'s Indian with ...f5.'], ['Stonewall', '...d5, ...e6 and ...c6: a fortress and play on e4.'], ['Staunton Gambit', '2.e4: White gives a pawn to hit the weakened king.']],
    watch: 'The e8-h5 diagonal is weak early: Qh5+ and Bg6 tricks.',
  },
  'Benoni Defense': {
    idea: 'Black plays ...c5 against d4 and lets White push d5, getting a queenside pawn majority and a fianchetto bishop. White has a central space edge and pushes e4-e5; Black plays ...b5 and ...Re8. Sharp and unbalanced.',
    lines: [['Modern Benoni', '...e6, ...exd5 and ...g6: the main line.'], ['Czech Benoni', '...e5: a closed centre.']],
    watch: 'White\'s e4-e5 break can come with great force; Black must be active.',
  },
  "King's Indian Defense": {
    idea: 'Black lets White build a big centre, castles behind a g7 fianchetto, then strikes with ...e5 or ...c5. When the centre locks, White attacks on the queenside and Black storms the kingside with ...f5. A race.',
    lines: [['Classical', 'Nf3, Be2 and O-O: the main line; ...Nc6 and ...Ne7 for the kingside attack.'], ['Sämisch', 'f3 and Be3: White secures e4 and often castles long.'], ['Four Pawns', 'f4: White takes the maximum centre.']],
    watch: 'Counting the race is everything: the side that is a tempo late loses.',
  },
  'Nimzo-Indian Defense': {
    idea: 'Black pins the c3 knight with ...Bb4 to fight for e4 with pieces, often giving the bishop for the knight to damage White\'s pawns. A flexible, highly respected defence.',
    lines: [['Rubinstein', '4.e3: White develops calmly.'], ['Classical', '4.Qc2: White avoids doubled pawns.'], ['Sämisch', '4.a3: White forces the trade and gets the bishop pair.']],
    watch: 'White\'s bishop pair gets strong if the position opens; Black should keep it closed.',
  },
  "Queen's Indian Defense": {
    idea: 'Black fianchettoes the queen\'s bishop to control e4 from b7. Solid and positional, with play against the centre from a distance.',
    lines: [['Petrosian', '4.a3: White stops ...Bb4.'], ['Fianchetto', '4.g3: White fights for the long diagonal.']],
    watch: 'The long diagonal is the battlefield; do not let it be blocked for free.',
  },
  'Bogo-Indian Defense': {
    idea: 'Black checks with ...Bb4+ to trade off pieces or make White\'s development awkward. Solid and easy to play.',
    lines: [['Main line', '4.Bd2: White offers the trade.']],
    watch: 'After trades Black can be a little passive; keep the pieces active.',
  },
  'Grünfeld Defense': {
    idea: 'Black lets White build a big centre with e4 and d4, then attacks it with ...d5, ...Bg7 and ...c5. Very dynamic: either the centre holds and White is better, or it cracks under the bishop on g7.',
    lines: [['Exchange', 'cxd5 Nxd5 e4: White takes the full centre.'], ['Russian', 'Qb3: White hits d5 at once.']],
    watch: 'Black must keep up the pressure on d4; a slow move lets the centre roll.',
  },
  'Englund Gambit': {
    idea: 'Black gives a pawn with 1...e5 against d4 for quick piece play and traps. Against good defence it is simply a pawn down.',
    lines: [['Main line', '2.dxe5 Nc6 3.Nf3 Qe7: Black hunts the e5 pawn and sets traps.']],
    watch: 'White must avoid the trap Bf4? Qb4+ hitting the bishop and b2.',
  },
  'Budapest Gambit': {
    idea: 'Black gives a pawn with ...e5 against d4 and c4, then wins it back on e5 with ...Ng4. Active and surprising, with quick piece play.',
    lines: [['Main line', '3...Ng4: Black hits e5 at once.'], ['Fajarowicz', '3...Ne4: wilder tactics.']],
    watch: 'White can keep the pawn with Bf4 and Nf3; then Black needs fast activity.',
  },
  'Benko Gambit': {
    idea: 'Black gives a queenside pawn with ...b5 and gets something that does not fade: open a- and b-files for the rooks, the bishop on g7 down the long diagonal, and steady queenside pressure. Unlike most gambits, Black is often glad to trade queens, because the pressure lasts into the endgame. Every game is decided on the queenside.',
    lines: [['Main line', '4.cxb5 a6 5.bxa6 Bxa6: rooks to a8 and b8, bishop to g7, pressure on a2 and b2.'], ['White returns the pawn', '5.b6, 5.f3, 5.e3 or 5.Nc3: White avoids the main fight.'], ['Declined', 'White does not take on b5 and plays for the centre.']],
    watch: 'Black must keep the files open: if the queenside closes, the pawn is simply lost.',
  },
  'Indian Defense': {
    idea: 'Black develops the knight first and keeps the choice between the many Indian set-ups (King\'s Indian, Nimzo, Queen\'s Indian, Grünfeld) open.',
    lines: [['To the King\'s Indian', '...g6 and ...Bg7.'], ['To the Nimzo or Queen\'s Indian', '...e6 and ...Bb4 or ...b6.']],
    watch: 'Each Indian has its own plans; pick one and learn it.',
  },
};
