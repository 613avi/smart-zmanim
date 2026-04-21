import json

with open('data/config.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

config['design']['theme'] = 'parchment'
# using an external generic shield logo, could use any image URL
config['design']['logoUrl'] = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Logo_of_the_Ministry_of_Education_of_Israel.svg/200px-Logo_of_the_Ministry_of_Education_of_Israel.svg.png'
config['design']['backgroundUrl'] = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Parchment-texture.jpg/1200px-Parchment-texture.jpg'

with open('data/config.json', 'w', encoding='utf-8') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)

print("config updated for logo and custom background")
