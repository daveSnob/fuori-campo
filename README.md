# Fuori Campo

Digest cinema personale, aggiornato ogni 4 ore.

- **Trailer della settimana**: trailer e teaser ufficiali degli ultimi 7 giorni dai canali YouTube di studi, distributori italiani e piattaforme (Netflix, Prime Video, Disney+, HBO Max, Apple TV, Peacock, Hulu, Sky), divisi in *Al cinema* / *In streaming*, più gli articoli-trailer della stampa.
- **In sala e in streaming**: guide alle uscite della settimana.
- **Rumor**: video di John Campea e Grace Randolph (Beyond The Trailer), scoop di World of Reel e The InSneider, articoli dei trade con trattative e indiscrezioni.
- **Notizie, Recensioni, Approfondimenti**: The Hollywood Reporter, Deadline, Variety, IndieWire, TheWrap, Collider, /Film, The Playlist, JoBlo, FirstShowing, Bleeding Cool, What's on Netflix, BadTaste, ScreenWeek, Ciak, Cineblog, Cineuropa.

File:
- `config.json`: testate, canali YouTube (con `where`: cinema/streaming), finestre temporali, limiti per sezione
- `digest.mjs`: scarica feed e canali e genera `fuori-campo.html` (`node digest.mjs`, Node 18+, nessuna dipendenza)
- `archivio.json` (generato): voci viste nei giri precedenti, così trailer e rumor restano per 7 giorni anche se escono dai feed

GitHub Actions rigenera e pubblica la pagina su GitHub Pages ogni 4 ore.
