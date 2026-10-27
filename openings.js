// Openings to practise. side = the colour you play.
// root = moves that define the opening; real-game variations branch off after it.
// family = Lichess opening name (data/*.tsv); your moves prefer book moves from this family.
export const OPENINGS = [
  { id: 'italienskt', root: 'e4 e5 Nf3 Nc6 Bc4', name: 'Italian Game', eco: 'C50', side: 'w', family: 'Italian Game',
    info: 'Fast development and pressure on f7. A classic start for White.' },
  { id: 'spanskt', root: 'e4 e5 Nf3 Nc6 Bb5', name: 'Ruy Lopez', eco: 'C60', side: 'w', family: 'Ruy Lopez',
    info: 'The bishop pressures the knight that defends e5.' },
  { id: 'damgambit', root: 'd4 d5 c4 e6', name: "Queen's Gambit Declined", eco: 'D30', side: 'w', family: "Queen's Gambit Declined",
    info: 'White offers the c-pawn to take control of the centre.' },
  { id: 'london', root: 'd4 d5 Bf4', name: 'London System', eco: 'D02', side: 'w', family: 'London System',
    info: 'A solid setup you can play against almost anything.' },
  { id: 'engelskt', root: 'c4', name: 'English Opening', eco: 'A10', side: 'w', family: 'English Opening',
    info: 'A reversed Sicilian with the bishop fianchettoed on g2.' },
  { id: 'najdorf', root: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', name: 'Sicilian, Najdorf', eco: 'B90', side: 'b', family: 'Sicilian Defense: Najdorf',
    info: 'Sharp and unbalanced. The move a6 prepares e5 or b5.' },
  { id: 'franskt', root: 'e4 e6 d4 d5 Nc3 Nf6', name: 'French, Classical', eco: 'C14', side: 'b', family: 'French Defense: Classical',
    info: 'Black builds a stable pawn chain and strikes back at the centre.' },
  { id: 'carokann', root: 'e4 c6', name: 'Caro-Kann', eco: 'B10', side: 'b', family: 'Caro-Kann Defense',
    info: 'A solid structure where the light-squared bishop gets out before e6.' },
  { id: 'skandinaviskt', root: 'e4 d5', name: 'Scandinavian', eco: 'B01', side: 'b', family: 'Scandinavian Defense',
    info: 'Black challenges e4 at once and recaptures with the queen.' },
  { id: 'kungsindiskt', root: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6', name: "King's Indian", eco: 'E60', side: 'b', family: "King's Indian Defense",
    info: 'Black lets White take the centre, then hits back with e5.' },
  { id: 'slaviskt', root: 'd4 d5 c4 c6', name: 'Slav', eco: 'D10', side: 'b', family: 'Slav Defense',
    info: 'Holds d5 with the c-pawn and keeps the bishop free.' },
];
