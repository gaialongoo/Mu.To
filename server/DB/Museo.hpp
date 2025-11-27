#ifndef MUSEO_HPP
#define MUSEO_HPP

#include <string>
#include <array>
#include <queue>
#include <unordered_map>
#include <vector>
#include <sstream>

#include <boost/graph/adjacency_list.hpp>
#include <boost/graph/breadth_first_search.hpp>

typedef boost::adjacency_list<boost::vecS, boost::vecS, boost::undirectedS> Graph;

enum Tono { INFANTILE, SEMPLICE, MEDIO, AVANZATO };
enum Tempo { VELOCE_IDX, INTERMEDIO_IDX, LENTO_IDX }; // indici 0,1,2

// Oggetto con nome, stanza e descrizioni
struct Oggetto {
    std::string nome;
    std::string stanza;
    std::string descrizione[4][3]; // TONO, TEMPO
};

template <int numeroOpere>
class Museo {
private:
    std::string nome;
    std::string citta;

    Graph mappa_oggetti;

public:
    // nome -> indice
    std::unordered_map<std::string, int> nome_oggetti;

    // indice -> stanza
    std::array<std::string, numeroOpere> stanze_oggetti;

    // indice -> nome
    std::array<std::string, numeroOpere> nomi_oggetti;

    // indice -> descrizioni [tono][tempo]
    std::array<std::array<std::array<std::string, 3>, 4>, numeroOpere> descrizioni_oggetti;

public:
    // costruttore
    Museo(const std::string& nome,
          const std::string& citta,
          const std::array<Oggetto, numeroOpere>& oggetti)
        : nome(nome), citta(citta), mappa_oggetti(numeroOpere)
    {
        for(int i = 0; i < numeroOpere; ++i) {
            nome_oggetti[oggetti[i].nome] = i;
            nomi_oggetti[i] = oggetti[i].nome;
            stanze_oggetti[i] = oggetti[i].stanza;

            // copia descrizioni
            for(int t = 0; t < 4; ++t) {
                for(int s = 0; s < 3; ++s) {
                    descrizioni_oggetti[i][t][s] = oggetti[i].descrizione[t][s];
                }
            }
        }
    }

    // collega due oggetti
    void connetti_oggetti(const std::string& o1, const std::string& o2) {
        boost::add_edge(nome_oggetti[o1], nome_oggetti[o2], mappa_oggetti);
    }

    // restituisce descrizione di un oggetto con tono e tempo
    std::string get_descrizione(const std::string& nomeOggetto, Tono tono, Tempo tempo) const {
        auto it = nome_oggetti.find(nomeOggetto);
        if (it == nome_oggetti.end()) return "";
        int idx = it->second;
        return descrizioni_oggetti[idx][tono][tempo];
    }

    // aggiorna descrizione
    void set_descrizione(const std::string& nomeOggetto, Tono tono, Tempo tempo, const std::string& nuovaDescrizione) {
        auto it = nome_oggetti.find(nomeOggetto);
        if (it == nome_oggetti.end()) return;
        int idx = it->second;
        descrizioni_oggetti[idx][tono][tempo] = nuovaDescrizione;
    }

    // BFS per trovare il percorso minimo
    std::vector<int> BFS_oggetti(const std::string& o1, const std::string& o2) {
        int start = nome_oggetti[o1];
        int goal = nome_oggetti[o2];

        std::vector<int> predecessore(boost::num_vertices(mappa_oggetti), -1);
        std::vector<bool> visitato(boost::num_vertices(mappa_oggetti), false);
        std::queue<int> q;

        visitato[start] = true;
        q.push(start);

        while(!q.empty()) {
            int u = q.front();
            q.pop();

            if(u == goal) break;

            auto [vi, vi_end] = boost::adjacent_vertices(u, mappa_oggetti);
            for(auto v = vi; v != vi_end; ++v) {
                if(!visitato[*v]) {
                    visitato[*v] = true;
                    predecessore[*v] = u;
                    q.push(*v);
                }
            }
        }

        // ricostruisci percorso
        std::vector<int> percorso;
        for(int at = goal; at != -1; at = predecessore[at])
            percorso.push_back(at);

        std::reverse(percorso.begin(), percorso.end());

        if(percorso.empty() || percorso[0] != start)
            percorso.clear();

        return percorso;
    }

    // Calcola percorso che passa per una lista di oggetti in ordine
    std::vector<int> calcola_percorso(const std::vector<std::string>& obbligatori) {
        std::vector<int> risultato;

        if (obbligatori.empty()) 
            return risultato;

        // converti da nomi a indici
        std::vector<int> tappe;
        tappe.reserve(obbligatori.size());
        for (const auto& nome : obbligatori)
            tappe.push_back(nome_oggetti.at(nome));

        // unisci i percorsi BFS fra ogni coppia consecutiva
        for (size_t i = 0; i + 1 < tappe.size(); ++i) {
            int a = tappe[i];
            int b = tappe[i+1];

            // prendi il percorso minimo tra i due
            std::vector<int> pezzo = BFS_oggetti(nomi_oggetti[a], nomi_oggetti[b]);

            // evita di duplicare il nodo di partenza (tranne la prima volta)
            if (!risultato.empty() && !pezzo.empty())
                pezzo.erase(pezzo.begin());

            risultato.insert(risultato.end(), pezzo.begin(), pezzo.end());
        }

        return risultato;
    }

    std::string to_json() const {
        std::ostringstream out;
        out << "{\n";
        out << "  \"nome\": \"" << nome << "\",\n";
        out << "  \"citta\": \"" << citta << "\",\n";
        out << "  \"oggetti\": [\n";

        bool first_oggetto = true;
        for (int i = 0; i < numeroOpere; ++i) {
            if (nomi_oggetti[i].empty()) continue;

            if (!first_oggetto) out << ",\n";
            first_oggetto = false;

            out << "    {\n";
            out << "      \"indice\": " << i << ",\n";
            out << "      \"nome\": \"" << nomi_oggetti[i] << "\",\n";
            out << "      \"stanza\": \"" << stanze_oggetti[i] << "\",\n";

            // Lista connessi
            out << "      \"connessi\": [";
            auto [vi, vend] = boost::adjacent_vertices(i, mappa_oggetti);
            bool first_conn = true;
            for (auto v = vi; v != vend; ++v) {
                if (nomi_oggetti[*v].empty()) continue;
                if (!first_conn) out << ", ";
                first_conn = false;
                out << "\"" << nomi_oggetti[*v] << "\"";
            }
            out << "],\n";

            // Descrizioni
            out << "      \"descrizioni\": [\n";
            for (int t = 0; t < 4; ++t) {
                out << "        [";
                for (int s = 0; s < 3; ++s) {
                    out << "\"" << descrizioni_oggetti[i][t][s] << "\"";
                    if (s < 2) out << ", ";
                }
                out << "]";
                if (t < 3) out << ",";
                out << "\n";
            }
            out << "      ]\n";

            out << "    }";
        }

        out << "\n  ]\n";
        out << "}\n";

        return out.str();
    }
};

#endif // MUSEO_HPP

