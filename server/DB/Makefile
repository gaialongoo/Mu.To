# Nome dell'eseguibile
TARGET = Museo

# File sorgente
SRC = uploadJSONtoMongoDB.cpp

# Compilatore
CXX = c++
CXXFLAGS = -std=c++17 -I/usr/local/include
LDFLAGS = -L/usr/local/lib -lboost_graph -lboost_system -lpthread

# Regola di default
all: $(TARGET)

# Compilazione dell'eseguibile
$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) -o $(TARGET) $(SRC) $(LDFLAGS)

# Pulizia dei file generati
clean:
	rm -f $(TARGET)

# Esegui il programma
run: $(TARGET)
	./$(TARGET)

