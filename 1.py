import chromadb

# Chroma client banaya
client = chromadb.Client()

# Collection banayi (jaise ek table)
collection = client.create_collection(name="my_notes")

# Documents add kiye (Chroma khud embedding banayega background mein)
collection.add(
    documents=[
        "AI Engineer models banata hai",
        "RAG technique se AI apni knowledge badhata hai",
        "Cricket ek popular sport hai India mein"
    ],
    ids=["doc1", "doc2", "doc3"]
)

# Ab search karo
results = collection.query(
    query_texts=["AI ke baare mein bata"],
    n_results=2   # top 2 sabse relevant chahiye
)

print(results["documents"])