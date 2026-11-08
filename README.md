# Fuori Campo

Digest cinema personale, aggiornato ogni ora. Per ogni voce: titolo, fonte, data e link all'originale (nessun estratto di testo).

## Sezioni
- **Trailer della settimana**: trailer e teaser ufficiali degli ultimi 7 giorni dai canali YouTube di studi, distributori italiani e piattaforme, divisi in *Al cinema* / *In streaming*, più gli articoli-trailer della stampa (raggruppati per film, con "anche su").
- **Al cinema**: i film in sala in Italia secondo MYmovies (pagina "Film al cinema"), ordinati per numero di sale, con regia, genere, distribuzione, data di uscita e link alla scheda. Se MYmovies non risponde resta l'ultimo elenco scaricato.
- **Date da segnare**: uscite italiane con countdown, al cinema e in streaming, lette da titolo e descrizione dei trailer italiani ufficiali ("Dal 19 novembre al cinema").
- **Piattaforme**: una scheda per servizio con i trailer delle novità (almeno `minTrailerPiattaforma`) e le notizie che lo riguardano.
- **In sala e in streaming**: guide alle uscite della settimana.
- **Rumor**: video di John Campea e Grace Randolph, scoop di World of Reel e The InSneider, trattative dai trade.
- **Notizie, Recensioni, Approfondimenti**.
- **Festival e premi**: Torino Film Festival, Oscar, AFM (`festival` in config.json), ultimi 30 giorni.

Filtri: "mostra solo" per testata, *solo nuovi*, *solo Italia* (distributori, piattaforme e testate italiane). Ogni lista mostra 8 voci con "Mostra tutto". Le voci duplicate (stesso URL, stesso titolo, stesso trailer caricato più volte, stessa notizia su più testate) compaiono una volta sola.

## File
- `config.json`: testate, canali YouTube (`where`: cinema/streaming, `platform`), piattaforme, festival, tracker, finestre temporali
- `digest.mjs`: scarica feed e canali e genera `fuori-campo.html` (`node digest.mjs`, Node 18+, nessuna dipendenza)
- `archivio.json` (generato): voci viste nei giri precedenti

## Aggiornamento
- `.github/workflows/digest.yml` rigenera e pubblica la pagina su GitHub Pages.
- `.github/workflows/orologio.yml` lo avvia ogni ora: i cron di GitHub sono "best effort" e quelli orari vengono spesso saltati, mentre un avvio manuale (`workflow_dispatch`) parte sempre. Il cron orario di digest.yml resta come riserva.
