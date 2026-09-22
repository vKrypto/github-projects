"""
list, tuple, dictionory


x = 4
print(x)

x = [2,3,4,4]

"""
multi_value_varaible = [1, 2, 22, 23,121]
multi_value_varaible = {"k1": 100000, "k2": 2, 1: 3}
multi_value_varaible = set((1,23,23,23, "aeqw", "132", 0, 1, -12))
multi_value_varaible = (3,4,5,56, "daas", [1,23,34])
multi_value_varaible = "asda"
multi_value_varaible = [[1,23,34], [2,213,314], [3,123,34]]


# for i in multi_value_varaible:
#     # print(i, type(i),  multi_value_varaible[i])
#     print(i, type(i))

# for ls in multi_value_varaible:
#     print("====")
#     for i in ls:
#         print(i)

# # 1- 10
# ls = [1, 2,3,4,5]
# for i in ls:
#     print(i)

"""
range(a, b)
range(b)


a=0 ==> from (included)
b ==> to (excluded)


range(5)
0, 1, 2, 3, 4


range(1, 11)
1 - 10
"""

# for i in range(1, 10):
#     print(i)

# print(tuple(range(1, 5)))
# print(int(range(1, 5))) ===> errror

# i = 0
# while (i < 10):
#     print(i)
#     if i >2 :
#         i = i + 2
#     else:
#         i = i + 1

# break ==> 
# continue ==> skip

for i in range(1, 10):
    if i == 4:
        continue  # skip
    print(i)
    if i == 8:
        break