#prima versione in python di un server HTTP che ritorno le varie richieste definite dalla openAPI
from flask import Flask, jsonify, abort
import json

app = Flask(__name__)

# Leggi il JSON dei musei dal file all'avvio del server
with open('musei.json', 'r', encoding='utf-8') as f:
    musei_data = json.load(f)["musei"]

@app.route('/musei', methods=['GET'])
def get_musei():
    """
    Endpoint per ottenere tutti i musei
    """
    return jsonify({"musei": musei_data})

@app.route('/musei/<string:nome_museo>', methods=['GET'])
def get_museo(nome_museo):
    """
    Endpoint per ottenere un museo specifico per nome
    """
    for museo in musei_data:
        if museo["nome"].lower() == nome_museo.lower():
            return jsonify(museo)
    abort(404, description="Museo non trovato")

if __name__ == '__main__':
    app.run(debug=True, port=5000)
