# Nome dell'eseguibile
TARGET = Museo

# File sorgente
SRC = generaDB_in_Json.cpp

# Compilatore
CXX = c++
CXXFLAGS = -std=c++17
LDFLAGS = -lpthread

# Rileva il sistema operativo
UNAME_S != uname -s

# Flags specifici per sistema (OpenBSD vs Linux)
.if (${UNAME_S} == "OpenBSD")
CXXFLAGS += -I/usr/local/include
LDFLAGS += -lboost_graph -lboost_system
.else
CXXFLAGS += -I/usr/local/include/mongocxx/v_noabi -I/usr/local/include/bsoncxx/v_noabi
LDFLAGS += -L/usr/local/lib -lmongocxx -lbsoncxx -lssl -lcrypto
.endif

# Regola di default
all: $(TARGET)

# Compilazione dell'eseguibile
$(TARGET):
	${CXX} ${CXXFLAGS} -o ${TARGET} ${SRC} ${LDFLAGS}

# Pulizia dei file generati
clean:
	rm -f ${TARGET}

# Esegui il programma
run: $(TARGET)
	./${TARGET}

