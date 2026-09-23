"""
functions:

reuse: 
clean code


def p():
    body

p()

def p(ajit):
    body

p(rehan)
    
if (i < 10):
    body

"""

def print_1_to_10():
    for i in range(10):
        print(i)


# print_1_to_10()

# print_1_to_10()

def monika():
    print("monika velly... ghoom rhi")
    print("monika laddoo... kha rhi")

monika()
print("---"*20)
monika()


def monika(cur_bf):
    print("monika....>", cur_bf, type(cur_bf))

print("---"*40)

monika("gadha")
monika("ashutosh")
monika("potty")
monika(-100)
monika([1, 20, 120, 12])


def rehan(cur_personality, cur_state="ghatiya"):
    print("rehan....>", cur_personality, cur_state)


print(">>>>>> " * 20, ":)")
rehan("lost", "ghatiya")
rehan("lost")


def rehan(cur_personality, *cur_states):
    # cur_states = ("ghatiya", "hawasi", "tharki")
    print("rehan....>", cur_personality, cur_states, type(cur_states))


rehan("lost", "ghatiya", "hawasi", "tharki")
rehan("lost", "ghatiya", "hawasi")
rehan("lost", "ghatiya")
rehan("lost")
