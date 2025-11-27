#include <mongocxx/client.hpp>
#include <mongocxx/instance.hpp>
#include <mongocxx/uri.hpp>
#include <bsoncxx/json.hpp>
#include <iostream>
#include <string>
#include "SistemaMusei.hpp"

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

    // JSON come stringa
    std::string jsonStr = sistema.to_json();

    // Inizializza driver
    mongocxx::instance inst{};
    mongocxx::client conn{mongocxx::uri{"mongodb://localhost:27017"}};

    // Seleziona database e collezione
    auto db = conn["musei"];
    auto col = db["musei"];

    try {
        // Converte stringa JSON in BSON e inserisce
        bsoncxx::document::value doc = bsoncxx::from_json(jsonStr);
        col.insert_one(doc.view());
        std::cout << "Documento inserito correttamente!" << std::endl;
    } catch (const std::exception &e) {
        std::cerr << "Errore: " << e.what() << std::endl;
    }

    return 0;
}

