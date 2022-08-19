Alt Text Crew
=============

A Twitter bot which exposes a number of utilities around alt text

Public Commands
---------------

Tag the bot in a tweet, quote tweet, or reply with one of these commands

**OCR** or **extract text**

Performs Optical Character Recognition on any images it finds, replying with the result in alt text of re-uploaded images.

**save**

Saves alt text on any images it finds to the [alt-text.org](https://alt-text.org) library.

**analyze links**

Checks the websites of any links found for their usage of alt text.

**explain**

Replies with a quick explanation of what alt text is and how to add it.


Private Commands
----------------

Direct message the bot with one of these commands

**fetch**

Search the [alt-text.org](https://alt-text.org) library for alt text for a tweet if you include a link or an image if you include one.

**OCR** or **extract text**

Perform Optical Character Recognition on images from a tweet if you include a link or an image if you include one.

**check**

Include a link to a tweet, a username, or a link to a user's profile to get an analysis of alt text usage.

**help**

Get a text version of these instructions


How Does The Bot Choose Which Image(s) to OCR?
----------------------------------------------

When you tag the bot to OCR an image, it first has to choose which image to analyze. It looks:

1. On the **tweet** with the command
2. On any tweet **quoted** in that tweet
3. On the tweet being **replied** to
4. On any tweet **quoted** in the tweet being **replied** to
