import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:flutter_colorpicker/flutter_colorpicker.dart';
import 'package:note_app/models/note.dart';
import 'package:note_app/providers/note_provider.dart';

class NoteDetailScreen extends StatefulWidget {
  final int? noteIndex;

  NoteDetailScreen({this.noteIndex});

  @override
  _NoteDetailScreenState createState() => _NoteDetailScreenState();
}

class _NoteDetailScreenState extends State<NoteDetailScreen> {
  final _formKey = GlobalKey<FormState>();
  late String _title;
  late String _content;
  late int _color;

  @override
  void initState() {
    super.initState();
    final noteProvider = Provider.of<NoteProvider>(context, listen: false);
    if (widget.noteIndex != null) {
      final note = noteProvider.notes[widget.noteIndex!];
      _title = note.title;
      _content = note.content;
      _color = note.color;
    } else {
      _title = '';
      _content = '';
      _color = Colors.white.value;
    }
  }

  void _saveNote() {
    if (_formKey.currentState!.validate()) {
      _formKey.currentState!.save();
      final noteProvider = Provider.of<NoteProvider>(context, listen: false);
      final note = Note(
        title: _title,
        content: _content,
        timestamp: DateTime.now(),
        color: _color,
      );
      if (widget.noteIndex != null) {
        noteProvider.updateNote(widget.noteIndex!, note);
      } else {
        noteProvider.addNote(note);
      }
      Navigator.pop(context);
    }
  }

  void _pickColor() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Pick a color'),
        content: SingleChildScrollView(
          child: ColorPicker(
            pickerColor: Color(_color),
            onColorChanged: (color) {
              setState(() {
                _color = color.value;
              });
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
            },
            child: Text('Done'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.noteIndex != null ? 'Edit Note' : 'Add Note'),
        actions: [
          IconButton(
            icon: Icon(Icons.color_lens),
            onPressed: _pickColor,
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              TextFormField(
                initialValue: _title,
                decoration: InputDecoration(labelText: 'Title'),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter a title';
                  }
                  return null;
                },
                onSaved: (value) {
                  _title = value!;
                },
              ),
              TextFormField(
                initialValue: _content,
                decoration: InputDecoration(labelText: 'Content'),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter content';
                  }
                  return null;
                },
                onSaved: (value) {
                  _content = value!;
                },
              ),
              SizedBox(height: 20),
              ElevatedButton(
                onPressed: _saveNote,
                child: Text('Save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
