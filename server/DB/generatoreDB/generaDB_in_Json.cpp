#include "../backend/SistemaMusei.hpp"
#include <iostream>
#include <fstream> // per std::ofstream

int main() {
    const int NUM_OGG = 10;

    // --- Oggetti per il Museo di Torino ---
    std::array<Oggetto, NUM_OGG> oggettiTorino = {
        Oggetto{
            "sarcofago", "stanza 1",
            { { "Un grande sarcofago con strani disegni",
                "Questo sarcofago sembra molto misterioso e antico...",
                "Nel sarcofago vediamo figure antiche..." },
              { "Sarcofago antico con decorazioni",
                "Questo sarcofago è decorato con figure...",
                "Il sarcofago mostra scene di vita antica..." },
              { "Sarcofago decorato del periodo egizio",
                "Un sarcofago del periodo egizio con geroglifici...",
                "Questo sarcofago egizio presenta scene rituali..." },
              { "Sarcofago egizio con iconografia funeraria complessa",
                "Il sarcofago mostra un’iconografia funeraria articolata...",
                "L’analisi del sarcofago rivela una complessa simbologia..." } }
        },
        Oggetto{
            "collana", "stanza 2",
            { { "Collana luccicante con perline colorate",
                "Questa collana è tutta colorata e scintilla...",
                "La collana brilla con tanti colori..." },
              { "Collana con perle e pietre preziose",
                "Una collana elegante con perle e pietre...",
                "La collana ha perle e pietre colorate..." },
              { "Collana di epoca rinascimentale",
                "Una collana rinascimentale con perle e pietre...",
                "Questa collana rinascimentale mostra l’abilità..." },
              { "Collana rinascimentale con lavorazione elaborata",
                "Collana storica rinascimentale, con perle e gemme...",
                "L’oggetto rappresenta la maestria artigianale rinascimentale..." } }
        },
        Oggetto{ "scettro", "stanza 2", {} },
        Oggetto{ "maschera", "stanza 3", {} },
        Oggetto{ "mummia", "stanza 1", {} },
        Oggetto{}, Oggetto{}, Oggetto{}, Oggetto{}, Oggetto{} // riempi fino a NUM_OGG
    };

    // --- Oggetti per un altro museo (es. Firenze) ---
    std::array<Oggetto, NUM_OGG> oggettiFirenze = {
        Oggetto{ "statua", "sala A", {} },
        Oggetto{ "dipinto", "sala B", {} },
        Oggetto{ "anfora", "sala C", {} },
        Oggetto{}, Oggetto{}, Oggetto{}, Oggetto{}, Oggetto{}, Oggetto{}, Oggetto{}
    };

    // --- SistemaMusei ---
    SistemaMusei<NUM_OGG> sistema;

    // Aggiungo i musei
    sistema.aggiungi_museo("Museo di Torino", "Torino", oggettiTorino);
    sistema.aggiungi_museo("Uffizi", "Firenze", oggettiFirenze);

    // Recupero un museo e collego gli oggetti
    auto museoTorino = sistema.get_museo("Museo di Torino");
    if (museoTorino) {
        museoTorino->connetti_oggetti("mummia", "sarcofago");
        museoTorino->connetti_oggetti("mummia", "collana");
        museoTorino->connetti_oggetti("collana", "scettro");
        museoTorino->connetti_oggetti("scettro", "maschera");
    }

    // Stampa JSON di tutti i musei
    //std::cout << sistema.to_json();

    // Supponendo che "sistema.to_json()" ritorni uno std::string con il JSON
    std::ofstream outFile("musei.json");
    if (!outFile) {
        std::cerr << "Errore nell'aprire il file musei.json per scrittura\n";
    } else {
        outFile << sistema.to_json();
        outFile.close();
        std::cout << "File musei.json creato con successo.\n";
    }

    return 0;
}

