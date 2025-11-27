#ifndef SISTEMA_MUSEI_HPP
#define SISTEMA_MUSEI_HPP

#include "Museo.hpp"
#include <unordered_map>
#include <memory>

// Classe che gestisce più musei
template <int numeroOpere>
class SistemaMusei {
private:
    // nome museo -> istanza
    std::unordered_map<std::string, std::shared_ptr<Museo<numeroOpere>>> musei;

public:
    // aggiungi un museo
    void aggiungi_museo(const std::string& nome,
                        const std::string& citta,
                        const std::array<Oggetto, numeroOpere>& oggetti) 
    {
        musei[nome] = std::make_shared<Museo<numeroOpere>>(nome, citta, oggetti);
    }

    // ottieni un museo per nome
    std::shared_ptr<Museo<numeroOpere>> get_museo(const std::string& nome) const {
        auto it = musei.find(nome);
        if (it != musei.end()) return it->second;
        return nullptr;
    }

    // rimuovi un museo
    void rimuovi_museo(const std::string& nome) {
        musei.erase(nome);
    }

    // esporta tutti i musei in JSON
    std::string to_json() const {
        std::ostringstream out;
        out << "{\n  \"musei\": [\n";
        bool first = true;
        for (const auto& [nome, museo] : musei) {
            if (!first) out << ",\n";
            first = false;
            out << museo->to_json();
        }
        out << "\n  ]\n}\n";
        return out.str();
    }
};

#endif // SISTEMA_MUSEI_HPP

