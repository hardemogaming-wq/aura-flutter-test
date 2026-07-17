import 'package:flutter/material.dart';
import 'package:note_taking_app/screens/note_screen.dart';
import 'package:note_taking_app/widgets/note_card.dart';

class HomeScreen extends StatefulWidget {
  @override
  _HomeScreenState createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> notes = [];

  void addNote(Map<String, dynamic> note) {
    setState(() {
      notes.add(note);
    });
  }

  void updateNote(int index, Map<String, dynamic> note) {
    setState(() {
      notes[index] = note;
    });
  }

  void deleteNote(int index) {
    setState(() {
      notes.removeAt(index);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Notes'),
      ),
      body: ListView.builder(
        itemCount: notes.length,
        itemBuilder: (context, index) {
          return NoteCard(
            note: notes[index],
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (context) => NoteScreen(
                    note: notes[index],
                    onSave: (note) => updateNote(index, note),
                  ),
                ),
              );
            },
            onDelete: () => deleteNote(index),
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => NoteScreen(
                onSave: addNote,
              ),
            ),
          );
        },
        child: Icon(Icons.add),
      ),
    );
  }
}
