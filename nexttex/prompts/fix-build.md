Fix the errors in the last build, then build again to show they are gone.

Read the errors from the most recent build of the document on screen. If it has not been built since the project was opened, build it first. Work from the errors, not the warnings: an undefined citation or an overfull box is not what stops the page from being made.

Take the errors in the order the log gives them, because one early mistake often causes several later ones. For each, open the file at the line it names, find the cause, and make the smallest change that removes it: a missing brace, a misspelt command, a math symbol outside math mode, a package the document uses but never loads. Keep the writer's words as they are; change only the LaTeX around them. If a package is missing from the machine rather than from the preamble, install it rather than working around it.

When you have fixed them, build the document again and read what it says. If new errors appear, fix those too. Stop when the build has no errors, or when an error needs a decision only I can make, such as which of two definitions to keep, and then ask.

End with one line per error: where it was, what caused it, and what you changed.
