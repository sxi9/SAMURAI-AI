"""Example SAMURAI plugin. Copy this file, rename it, change the tools. The action server loads every
plugins/*.py at start (restart ACTIONS from the control panel after adding one). Each tool becomes an
action type the brain can call, with the description shown to the AI.

A tool is a plain function: it receives the argument string and returns the text SAMURAI will say.
"""
import random, time


def roll_dice(arg):
    sides = int("".join(ch for ch in (arg or "6") if ch.isdigit()) or 6)
    return f"Rolled a {random.randint(1, max(2, sides))} on a {sides}-sided die."


def unix_time(arg):
    return f"Unix time is {int(time.time())}."


def coin_flip(arg):
    return "Heads." if random.random() < 0.5 else "Tails."


PLUGIN = {
    "name": "example-tools",
    "description": "Dice, coin flip and the Unix clock — a template for your own tools.",
    "tools": [
        {"type": "roll_dice", "description": "roll a die; arg = number of sides (default 6)", "run": roll_dice},
        {"type": "coin_flip", "description": "flip a coin", "run": coin_flip},
        {"type": "unix_time", "description": "tell the current Unix timestamp", "run": unix_time},
    ],
}
